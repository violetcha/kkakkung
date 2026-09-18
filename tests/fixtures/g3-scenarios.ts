// F-12 / QA-07 fixture. Assembles A's real match engine (`matchCore`) with B's real tick path
// (MatchContext → CommandQueue → MatchDriver, optionally RoomTickCoordinator) for six players on
// a small seeded layout. Nothing here starts a server, a timer or the network; time is a fake
// monotonic clock advanced by the test. Results obtained here are LOCAL_VERIFIED integration of
// the product modules, not Cloud/device evidence.
import type { CommandEnvelope, CommandOutcome } from '@kkakkung/protocol/game-messages';
import {
  MATCH_TUNING_CONSTANTS,
  MATCH_TUNING_DEFAULTS,
  matchCore,
  type MatchLayout,
  type MatchState,
  type Topology,
} from '@kkakkung/game-core/match';
import { CommandQueue } from '../../server/src/game/CommandQueue.ts';
import { MatchContext } from '../../server/src/game/MatchContext.ts';
import { MatchDriver } from '../../server/src/game/MatchDriver.ts';
import type {
  AbortReason,
  AudienceEvent,
  MatchTuning,
  MediaIntent,
  TrustedMediaFrame,
} from '../../server/src/game/ports.ts';

export type Role = 'runner' | 'tagger';
export type Dir = 0 | 1 | 2 | 3;
export type Cell = Readonly<{ x: number; y: number }>;
export type Placement = Readonly<{ playerId: string; role: Role; cell: Cell; dir: Dir }>;

/** Undecided product items (D-2026-09-08-01). Never a pass/fail condition in these tests. */
export const PRODUCT_DECISION_PENDING = Object.freeze([
  'MP-06',
  'EQ-06',
  'EQ-07',
  'EQ-08',
  'EQ-09',
  'EQ-12',
  'G3-C',
] as const);

/**
 * Rules that reached develop on 2026-09-10 and replaced the former tripwires: the G3-A escape and
 * G3-B trap scenarios now run against A's real handlers, nothing is mocked.
 */
export const G3_RULES_LANDED = Object.freeze({
  escape: 'A-33 (EX-02/EX-03) EXIT_START/EXIT_CANCEL/EXIT_PROGRESS in matchCore',
  trap: 'A-23..A-27 (EQ-01..EQ-05) INSTALL/INSTALL_CANCEL, arming, trap activation, restraint',
} as const);

export const G3_TUNING: MatchTuning = Object.freeze({
  tuningVersion: 'g3-test-tuning',
  ...MATCH_TUNING_CONSTANTS,
  ...MATCH_TUNING_DEFAULTS,
});

export const MATCH_ID = 'g3-match';
export const SEED = 20260910;

/**
 * 12×12 open room. Interior is walkable except three wall cells on row 2 that carry the
 * runners' exits (exit walls must be interior, non-walkable, with a walkable approach).
 */
export function g3Topology(): Topology {
  const width = 12;
  const height = 12;
  const walls = new Set(['2,2', '5,2', '8,2']);
  const walkable = Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    const interior = x > 0 && x < width - 1 && y > 0 && y < height - 1;
    return interior && !walls.has(`${x},${y}`);
  });
  return { topologyVersion: 'g3-topology-1', width, height, walkable };
}

/** Every tagger stands one cell south of a runner, facing north: one forward move is a contact capture. */
export const DEFAULT_PLACEMENTS: readonly Placement[] = Object.freeze([
  { playerId: 'r1', role: 'runner', cell: { x: 5, y: 6 }, dir: 0 },
  { playerId: 'r2', role: 'runner', cell: { x: 2, y: 8 }, dir: 0 },
  { playerId: 'r3', role: 'runner', cell: { x: 8, y: 8 }, dir: 0 },
  { playerId: 't1', role: 'tagger', cell: { x: 5, y: 7 }, dir: 0 },
  { playerId: 't2', role: 'tagger', cell: { x: 2, y: 9 }, dir: 0 },
  { playerId: 't3', role: 'tagger', cell: { x: 8, y: 9 }, dir: 0 },
]);

export function g3Layout(placements: readonly Placement[] = DEFAULT_PLACEMENTS): MatchLayout {
  const topology = g3Topology();
  const runners = placements.filter((p) => p.role === 'runner');
  const exitWalls: Cell[] = [
    { x: 5, y: 2 },
    { x: 2, y: 2 },
    { x: 8, y: 2 },
  ];
  const poses = ['left', 'right', 'y'] as const;
  return {
    layoutId: 'g3-layout-1',
    topology,
    players: placements.map((p) => ({ ...p })),
    exits: runners.map((runner, i) => {
      const wall = exitWalls[i]!;
      return {
        exitId: `exit-${runner.playerId}`,
        ownerId: runner.playerId,
        wall: { x: wall.x, y: wall.y, side: 2 as Dir },
        approach: { x: wall.x, y: wall.y + 1 },
        poseKind: poses[i % 3]!,
      };
    }),
    territories: placements
      .filter((p) => p.role === 'tagger')
      .map((p) => ({ playerId: p.playerId, cells: [p.cell] })),
  };
}

export type FakeClock = Readonly<{
  now: () => number;
  advance: (ms: number) => number;
  set: (ms: number) => void;
}>;

export function fakeClock(start = 1000): FakeClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => (current += ms),
    set: (ms) => {
      current = ms;
    },
  };
}

export const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export type HarnessOptions = Readonly<{
  placements?: readonly Placement[];
  seed?: number;
  clock?: FakeClock;
  /** Roster order handed to createMatch; the engine sorts ids, so this must not matter. */
  rosterOrder?: 'given' | 'reversed';
}>;

export type RecordedOutcome = Readonly<{ actorId: string; outcome: CommandOutcome }>;

export function createG3Harness(options: HarnessOptions = {}) {
  const clock = options.clock ?? fakeClock();
  const placements = options.placements ?? DEFAULT_PLACEMENTS;
  const layout = g3Layout(placements);
  const roster = placements.map((p) => ({ playerId: p.playerId, role: p.role }));
  const players = options.rosterOrder === 'reversed' ? [...roster].reverse() : roster;
  const context = new MatchContext({ serverEpoch: 'g3-epoch', matchId: MATCH_ID });
  const queue = new CommandQueue();
  const outcomes: RecordedOutcome[] = [];
  const events: AudienceEvent[] = [];
  const frames: TrustedMediaFrame[] = [];
  const intents: MediaIntent[] = [];
  const integrityFailures: string[] = [];
  const committedTicks: number[] = [];
  const driver = new MatchDriver<MatchState>({
    core: matchCore,
    context,
    queue,
    now: clock.now,
    handlePhaseCommand: () => ({ result: 'applied', code: null }),
    onStateCommitted: (_instance, tick) => committedTicks.push(tick),
    stateVersionFor: () => context.stateVersion,
    onOutcome: (actorId, outcome) => outcomes.push({ actorId, outcome }),
    onEvent: (event) => events.push(event),
    onMediaFrame: (frame) => frames.push(frame),
    onMediaIntent: (intent) => intents.push(intent),
    onIntegrityFailure: (id, reason) => integrityFailures.push(`${id}:${reason}`),
  });
  const instance = context.createInstance('game');
  const initial = matchCore.createMatch({
    matchId: MATCH_ID,
    gameInstanceId: instance.gameInstanceId,
    seed: options.seed ?? SEED,
    tuning: G3_TUNING,
    layout,
    players,
  });
  driver.attach({
    gameInstanceId: instance.gameInstanceId,
    kind: 'game',
    state: initial,
    topology: layout.topology,
    mediaInstanceId: 'media-g3',
  });
  for (const p of placements) context.enterInstance(p.playerId, instance.gameInstanceId);

  const sequences = new Map<string, number>();
  const actorOffset = new Map(placements.map((p, i) => [p.playerId, (i + 1) * 100_000]));
  const nextSequence = (actorId: string) => {
    const next = (sequences.get(actorId) ?? 0) + 1;
    sequences.set(actorId, next);
    return next;
  };
  const envelope = <T extends CommandEnvelope['type']>(
    actorId: string,
    type: T,
    payload: Extract<CommandEnvelope, { type: T }>['payload'],
  ): CommandEnvelope => {
    const sequence = nextSequence(actorId);
    return {
      matchId: MATCH_ID,
      requestId: uuid((actorOffset.get(actorId) ?? 900_000) + sequence),
      sequence,
      type,
      payload,
    } as CommandEnvelope;
  };
  const accept = (actorId: string, command: CommandEnvelope) =>
    queue.accept({
      actorId,
      command,
      gameInstanceId: instance.gameInstanceId,
      nowMs: clock.now(),
      stateVersion: context.stateVersion,
    });

  const state = () => driver.instance(instance.gameInstanceId)!.state;
  const player = (id: string) => {
    const record = state().players.get(id);
    if (!record) throw new Error(`unknown player ${id}`);
    return record;
  };

  return {
    clock,
    context,
    queue,
    driver,
    instance,
    layout,
    outcomes,
    events,
    frames,
    intents,
    integrityFailures,
    committedTicks,
    state,
    frame: () => matchCore.getFrame(state()),
    player,
    accept,
    envelope,
    /** MOVE_INTENT (held move refreshed at 10 Hz by real clients; here sent once). */
    move: (actorId: string, direction: 'forward' | 'back' | null = 'forward') =>
      accept(actorId, envelope(actorId, 'MOVE_INTENT', { direction })),
    turn: (actorId: string, direction: 'left' | 'right') =>
      accept(actorId, envelope(actorId, 'TURN', { direction })),
    /** Stop intent: drops the held move so a finished step does not resume on its own. */
    stop: (actorId: string) =>
      accept(actorId, envelope(actorId, 'MOVE_INTENT', { direction: null })),
    /**
     * Walks `steps` cells in the facing direction, exactly one move per step. The stop intent is
     * processed on the completion tick, so the held move does not resume into a further cell
     * (real clients refresh the intent at 10 Hz and release it; here one envelope stands in).
     */
    walk(actorId: string, steps: number, direction: 'forward' | 'back' = 'forward') {
      for (let i = 0; i < steps; i++) this.step(actorId, direction);
    },
    /** One cell: MOVE_INTENT, the move's ticks, and a stop landing on the completion tick. */
    step(actorId: string, direction: 'forward' | 'back' = 'forward') {
      this.move(actorId, direction);
      this.ticks(G3_TUNING.moveTicks);
      this.stop(actorId);
      this.tick();
    },
    /** Turns once and waits for the turn to finish. */
    face(actorId: string, direction: 'left' | 'right') {
      this.turn(actorId, direction);
      this.ticks(G3_TUNING.turnTicks + 1);
    },
    /** Sends any protocol command and steps one tick; returns that actor's latest outcome. */
    send<T extends CommandEnvelope['type']>(
      actorId: string,
      type: T,
      payload: Extract<CommandEnvelope, { type: T }>['payload'],
    ) {
      // The pairing is checked on this method's signature; `envelope` cannot re-derive it from a
      // generic T, so the forwarded values are widened here.
      accept(actorId, envelope(actorId, type as never, payload as never));
      this.tick();
      return this.lastOutcome(actorId);
    },
    /** Advances until the authoritative tick reaches `tick` (no-op when already there). */
    until(tick: number) {
      while ((state().tick ?? 0) < tick) this.tick();
    },
    /** Opens play the way the room does: START_PLAYING control applied on the next tick. */
    start() {
      driver.enqueueControl(instance.gameInstanceId, {
        type: 'START_PLAYING',
        startTick: context.serverTick + 1,
      });
      return this.tick();
    },
    /** One authoritative tick: the clock advances one tick period, then the driver steps. */
    tick(advanceMs = G3_TUNING.tickMs) {
      clock.advance(advanceMs);
      return driver.tick();
    },
    ticks(count: number, advanceMs = G3_TUNING.tickMs) {
      const reports = [];
      for (let i = 0; i < count; i++) reports.push(this.tick(advanceMs));
      return reports;
    },
    lost(playerId: string) {
      driver.enqueueControl(instance.gameInstanceId, { type: 'CONNECTION_LOST', playerId });
    },
    abort(reason: AbortReason) {
      driver.enqueueControl(instance.gameInstanceId, { type: 'ABORT_MATCH', reason });
    },
    outcomesOf: (actorId: string) => outcomes.filter((o) => o.actorId === actorId),
    lastOutcome: (actorId: string) => outcomes.filter((o) => o.actorId === actorId).at(-1)?.outcome,
  };
}

export type G3Harness = ReturnType<typeof createG3Harness>;

/** Deterministic, order-independent digest of the authoritative frame for fixture-order tests. */
export function frameDigest(harness: G3Harness) {
  const frame = harness.frame();
  const s = harness.state();
  return {
    tick: frame.tick,
    phase: frame.phase,
    counts: frame.counts,
    result: frame.result,
    abortReason: frame.abortReason,
    participants: [...frame.participants]
      .map((p) => ({ id: p.playerId, role: p.role, status: p.status, cell: p.cell, dir: p.dir }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    activeExits: [...s.exits.values()]
      .filter((e) => e.active)
      .map((e) => e.exitId)
      .sort(),
    priority: s.priority,
  };
}
