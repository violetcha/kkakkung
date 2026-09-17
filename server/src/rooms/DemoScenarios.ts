/**
 * S15P21C204-259. Demo scenarios for the operator-only demo room. A scenario is a short list of
 * steps that ends as ordinary commands from the puppets, so every judgement (restraint, capture,
 * escape, result) is made by A's rules exactly as in a real match. Nothing here writes state or
 * talks to the network: the room feeds it the current world and sends what it asks for.
 */
import { isWalkable } from '@kkakkung/game-core/match';
import type { Cell, Dir, Role } from '@kkakkung/protocol/game-schema';
import type { GameSubject, Topology } from '../game/ports.js';

export const DEMO_SCENARIOS = [
  'trap',
  'sensor',
  'capture',
  'capture-one',
  'approach',
  'exit',
  'exchange',
  'exchange-cancel',
  'exchange-trace',
  'result-tagger-win',
  'result-runner-win',
  'abort-connection-lost',
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export type DemoExit = Readonly<{ exitId: string; ownerId: string; approach: Cell; wall: Cell }>;

/**
 * What the room knows this tick. Challenge and exchange ids come from the core, never from this
 * module: `exchanges` holds each puppet's one session (incoming or outgoing) while it lives.
 */
export type DemoWorld = Readonly<{
  tick: number;
  topology: Topology;
  participants: readonly GameSubject[];
  exits: readonly DemoExit[];
  /** Placement cells of the match. The rules never allow a device on one. */
  startCells: readonly Cell[];
  challenges: Readonly<Record<string, string>>;
  exchanges: Readonly<Record<string, string>>;
  operatorId: string;
  puppetIds: readonly string[];
}>;

export type PuppetCommand =
  | Readonly<{ type: 'MOVE_INTENT'; payload: { direction: 'forward' | 'back' | null } }>
  | Readonly<{ type: 'TURN'; payload: { direction: 'left' | 'right' } }>
  | Readonly<{ type: 'INSTALL'; payload: { kind: 'sensor' | 'trap' } }>
  | Readonly<{ type: 'EXIT_START'; payload: { exitId: string } }>
  | Readonly<{ type: 'EXCHANGE_ACCEPT'; payload: { exchangeId: string } }>
  | Readonly<{ type: 'EXCHANGE_CANCEL'; payload: { exchangeId: string } }>
  | Readonly<{
      type: 'EXIT_PROGRESS';
      payload: { challengeId: string; method: 'pose' | 'keys'; completed: boolean };
    }>
  | Readonly<{ type: 'EXCHANGE_REQUEST'; payload: { targetPlayerId: string } }>;

export type DemoStatus = Readonly<{
  scenario: DemoScenario | null;
  step: string | null;
  failure: string | null;
}>;

const DIRECTIONS: readonly { dx: number; dy: number }[] = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];
/** A step that cannot finish is abandoned rather than left blocking the room. */
const STEP_TIMEOUT_TICKS = 1200;
/** Installation (10) plus arming (20) with room to spare: the device must be live to be shown. */
const ARM_WAIT_TICKS = 60;
/** The rules require the pose to stand for two seconds before a report can succeed. */
const POSE_HOLD_TICKS = 50;
/** An exchange offer lives 2 seconds (40 ticks); a session that never appears was refused. */
const EXCHANGE_OFFER_TICKS = 40;
/** A trace shows 1 second after the exchange and stays 2 seconds: the scenario waits it out. */
const TRACE_SHOW_TICKS = 60;
/** Long enough for the operator to see an incoming offer before the puppet withdraws it. */
const CANCEL_AFTER_TICKS = 20;

type Target = Cell | ((world: DemoWorld) => Cell | null);

type Step =
  | { kind: 'walk'; actor: string; target: Target; adjacent?: boolean; label: string }
  | { kind: 'face'; actor: string; target: Target; label: string }
  | {
      kind: 'send';
      actor: string;
      command: (world: DemoWorld) => PuppetCommand | null;
      label: string;
    }
  | { kind: 'wait'; ticks: number; label: string }
  | { kind: 'until'; done: (world: DemoWorld) => boolean; timeout?: number; label: string }
  /** The room drops the puppet's connection as if its socket died: a rules-owned abort. */
  | { kind: 'drop'; actor: string; label: string };

export type DemoIo = Readonly<{
  send: (actor: string, command: PuppetCommand) => boolean;
  /** Absent when the room cannot drop puppets; a `drop` step then fails instead of blocking. */
  drop?: (actor: string) => boolean;
}>;

export interface DemoRunner {
  /** Starts a scenario, replacing whatever was running. Returns the rejection reason, or null. */
  start(scenario: DemoScenario, world: DemoWorld): string | null;
  /** One room tick. Emits at most one command per step through `send`. */
  advance(world: DemoWorld, io: DemoIo | DemoIo['send']): void;
  stop(): void;
  readonly status: DemoStatus;
}

/** The scenarios that can start in this world: what the operator's role and the puppets allow. */
export function availableScenarios(world: DemoWorld): DemoScenario[] {
  return DEMO_SCENARIOS.filter((scenario) => typeof build(scenario, world) !== 'string');
}

/** One puppet's own list of steps. Tracks run side by side so two puppets can act at once. */
type Track = { steps: Step[]; index: number; enteredAt: number };

export function createDemoRunner(): DemoRunner {
  let scenario: DemoScenario | null = null;
  let tracks: Track[] = [];
  let failure: string | null = null;
  /**
   * Puppets whose last forward intent has not been released yet. The server keeps an intent
   * held until it is released or its TTL lapses, and the held move resumes in the very tick the
   * first cell completes, so an unreleased intent walks a second cell before the scenario can
   * look again. Releasing on the next tick makes one intent exactly one cell: in a corridor one
   * cell wide (S15P21C204-267) the overshoot otherwise never converges on a neighbouring cell.
   */
  const releasing = new Set<string>();

  const finish = (reason: string | null) => {
    if (reason) failure = reason;
    scenario = null;
    tracks = [];
    releasing.clear();
  };
  return {
    start(next, world) {
      const built = build(next, world);
      if (typeof built === 'string') return built;
      scenario = next;
      tracks = built.map((steps) => ({ steps, index: 0, enteredAt: world.tick }));
      failure = null;
      releasing.clear();
      return null;
    },
    stop: () => finish(null),
    advance(world, given) {
      if (!scenario) return;
      const io: DemoIo = typeof given === 'function' ? { send: given } : given;
      for (const track of tracks) {
        const step = track.steps[track.index];
        if (!step) continue;
        const elapsed = world.tick - track.enteredAt;
        const budget =
          step.kind === 'until' ? (step.timeout ?? STEP_TIMEOUT_TICKS) : STEP_TIMEOUT_TICKS;
        if (elapsed > budget) return finish(`${step.label}:TIMEOUT`);
        const outcome = run(step, world, io, elapsed, releasing);
        if (outcome === 'failed') return finish(`${step.label}:FAILED`);
        if (outcome === 'done') {
          track.index += 1;
          track.enteredAt = world.tick;
        }
      }
      if (tracks.every((track) => track.index >= track.steps.length)) finish(null);
    },
    get status() {
      const running = tracks
        .map((track) => track.steps[track.index]?.label)
        .filter((label): label is string => label !== undefined);
      return { scenario, step: running[0] ?? null, failure };
    },
  };
}

function run(
  step: Step,
  world: DemoWorld,
  { send, drop }: DemoIo,
  elapsed: number,
  releasing: Set<string>,
): 'done' | 'running' | 'failed' {
  if (step.kind === 'wait') return elapsed >= step.ticks ? 'done' : 'running';
  if (step.kind === 'until') return step.done(world) ? 'done' : 'running';
  const actor = subject(world, step.actor);
  if (!actor || actor.status !== 'ACTIVE') return 'failed';
  // The tick after a forward intent: let go of it before the first cell completes, so the
  // server does not carry the puppet on into a second cell. Retried until the queue takes it.
  if (releasing.has(actor.playerId)) {
    if (send(actor.playerId, { type: 'MOVE_INTENT', payload: { direction: null } }))
      releasing.delete(actor.playerId);
    return 'running';
  }
  if (step.kind === 'drop') return drop?.(step.actor) ? 'done' : 'failed';
  if (step.kind === 'send') {
    const command = step.command(world);
    if (!command) return 'failed';
    return send(step.actor, command) ? 'done' : 'failed';
  }
  // A puppet in the middle of a move, turn or installation is left to finish it.
  if (actor.action) return 'running';
  const target = typeof step.target === 'function' ? step.target(world) : step.target;
  if (!target) return 'failed';
  if (step.kind === 'face') return turnToward(actor, target, send) ?? 'done';
  return walk(actor, target, step.adjacent === true, world, send, releasing);
}

/** Emits the turn that brings the actor one quarter closer to `target`, or null when it faces it. */
function turnToward(
  actor: GameSubject,
  target: Cell,
  send: (actor: string, command: PuppetCommand) => boolean,
): 'running' | 'failed' | null {
  const desired = directionTo(actor.cell, target);
  if (desired === null) return 'failed';
  if (desired === actor.dir) return null;
  const clockwise = (desired - actor.dir + 4) % 4;
  return send(actor.playerId, {
    type: 'TURN',
    payload: { direction: clockwise === 3 ? 'left' : 'right' },
  })
    ? 'running'
    : 'failed';
}

function walk(
  actor: GameSubject,
  target: Cell,
  adjacent: boolean,
  world: DemoWorld,
  send: (actor: string, command: PuppetCommand) => boolean,
  releasing: Set<string>,
): 'done' | 'running' | 'failed' {
  if (sameCell(actor.cell, target)) return 'done';
  const next = pathStep(world, actor, target, adjacent);
  if (next === 'arrived') return 'done';
  if (!next) return 'failed';
  const turn = turnToward(actor, next, send);
  if (turn) return turn;
  // Facing the next cell: one forward intent starts one move under the server's timing, and the
  // release the runner sends on the next tick keeps it to that one cell.
  if (!send(actor.playerId, { type: 'MOVE_INTENT', payload: { direction: 'forward' } }))
    return 'failed';
  releasing.add(actor.playerId);
  return 'running';
}

/**
 * One step toward `target`, walking around everyone else. Stepping onto another participant is
 * a capture under the rules, so a scenario only does it when that participant is the target.
 */
function pathStep(
  world: DemoWorld,
  actor: GameSubject,
  target: Cell,
  adjacent: boolean,
): Cell | 'arrived' | null {
  const blocked = new Set(
    world.participants
      .filter(
        (player) =>
          player.playerId !== actor.playerId &&
          player.status === 'ACTIVE' &&
          !sameCell(player.cell, target),
      )
      .map((player) => key(player.cell)),
  );
  // Breadth-first from the target, so the actor can walk down the distances it finds.
  const distances = new Map<string, number>([[key(target), 0]]);
  const queue: Cell[] = [target];
  for (let index = 0; index < queue.length; index++) {
    const cell = queue[index]!;
    const distance = distances.get(key(cell))!;
    for (const next of neighbours(world.topology, cell)) {
      if (distances.has(key(next)) || (blocked.has(key(next)) && !sameCell(next, actor.cell)))
        continue;
      distances.set(key(next), distance + 1);
      queue.push(next);
    }
  }
  const here = distances.get(key(actor.cell));
  if (here === undefined) return null;
  if (adjacent && here <= 1) return 'arrived';
  return (
    neighbours(world.topology, actor.cell).find((cell) => distances.get(key(cell)) === here - 1) ??
    null
  );
}

const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
const key = (cell: Cell) => `${cell.x},${cell.y}`;

function neighbours(topology: Topology, cell: Cell): Cell[] {
  return DIRECTIONS.map((vector) => ({ x: cell.x + vector.dx, y: cell.y + vector.dy })).filter(
    (next) => isWalkable(topology, next),
  );
}

function directionTo(from: Cell, to: Cell): Dir | null {
  const index = DIRECTIONS.findIndex(
    (vector) => from.x + vector.dx === to.x && from.y + vector.dy === to.y,
  );
  return index < 0 ? null : (index as Dir);
}

/** Whether an ACTIVE participant stands on the cell. */
function occupied(world: DemoWorld, cell: Cell): boolean {
  return world.participants.some(
    (player) => player.status === 'ACTIVE' && sameCell(player.cell, cell),
  );
}

/** A passage cell a device may go on: not a start cell and nobody standing there. */
function isFree(world: DemoWorld, cell: Cell): boolean {
  return !world.startCells.some((start) => sameCell(start, cell)) && !occupied(world, cell);
}

/** An inner wall next to the cell, for a sensor to be mounted on; null in open floor. */
function wallBeside(world: DemoWorld, cell: Cell): Cell | null {
  return (
    DIRECTIONS.map((vector) => ({ x: cell.x + vector.dx, y: cell.y + vector.dy })).find(
      (next) => !isWalkable(world.topology, next),
    ) ?? null
  );
}

/** The cell the player is looking at, when it is a passage. */
function aheadOf(player: GameSubject, topology: Topology): Cell | null {
  const vector = DIRECTIONS[player.dir]!;
  const ahead = { x: player.cell.x + vector.dx, y: player.cell.y + vector.dy };
  return isWalkable(topology, ahead) ? ahead : null;
}

function subject(world: DemoWorld, playerId: string): GameSubject | null {
  return world.participants.find((player) => player.playerId === playerId) ?? null;
}

function puppetsOf(world: DemoWorld, role: Role): GameSubject[] {
  return world.participants.filter(
    (player) =>
      player.status === 'ACTIVE' &&
      player.role === role &&
      world.puppetIds.includes(player.playerId),
  );
}

/** Builds the tracks of a scenario against the current world, or returns why it cannot run. */
function build(scenario: DemoScenario, world: DemoWorld): Step[][] | string {
  const operator = subject(world, world.operatorId);
  if (!operator || operator.status !== 'ACTIVE') return 'OPERATOR_NOT_ACTIVE';
  const taggers = puppetsOf(world, 'tagger');
  const runners = puppetsOf(world, 'runner');
  // Re-read each tick so a puppet follows an operator who keeps moving.
  const operatorCell = (now: DemoWorld) => subject(now, world.operatorId)?.cell ?? null;

  switch (scenario) {
    case 'trap':
    case 'sensor': {
      const tagger = taggers[0];
      if (!tagger) return 'NO_TAGGER_PUPPET';
      const kind = scenario === 'trap' ? ('trap' as const) : ('sensor' as const);
      // The cell straight ahead of the operator is the natural spot; any other neighbour will
      // do. A start cell is refused by the rules, and a cell someone stands on is a capture
      // waiting to happen when the installer walks in, so neither is ever chosen.
      const ahead = aheadOf(operator, world.topology);
      const candidates = [
        ...(ahead ? [ahead] : []),
        ...neighbours(world.topology, operator.cell).filter(
          (cell) => !ahead || !sameCell(cell, ahead),
        ),
      ].filter((cell) => isFree(world, cell) && (kind === 'trap' || wallBeside(world, cell)));
      const spot = candidates[0];
      if (!spot) return kind === 'trap' ? 'NO_ROOM_TO_INSTALL' : 'NO_WALL_TO_MOUNT';
      const steps: Step[] = [
        { kind: 'walk', actor: tagger.playerId, target: spot, label: 'walk-to-spot' },
      ];
      if (kind === 'sensor') {
        // A sensor sits on a wall face, so the puppet has to look at a wall from that cell.
        const wall = wallBeside(world, spot)!;
        steps.push({ kind: 'face', actor: tagger.playerId, target: wall, label: 'face-wall' });
      }
      // The installer stands on the device cell. It must leave before a runner enters, or the
      // runner walks into a tagger and the rules call that a capture, not a trap or a sensor.
      // The installer's own cell counts as free: it will have left it for the spot by then.
      const retreat = neighbours(world.topology, spot).find(
        (cell) =>
          !sameCell(cell, operator.cell) && (!occupied(world, cell) || sameCell(cell, tagger.cell)),
      );
      if (!retreat) return 'NO_ROOM_TO_RETREAT';
      steps.push(
        {
          kind: 'send',
          actor: tagger.playerId,
          command: () => ({ type: 'INSTALL', payload: { kind } }),
          label: 'install',
        },
        // Installing and arming are the rules' own timings; the scenario only waits them out.
        { kind: 'wait', ticks: ARM_WAIT_TICKS, label: 'wait-armed' },
        { kind: 'walk', actor: tagger.playerId, target: retreat, label: 'step-back' },
      );
      // A runner operator walks into the device by hand. A tagger operator cannot trigger it, so
      // a puppet runner enters the cell and the operator watches the trace and hears the sound.
      if (operator.role === 'tagger') {
        const runner = runners[0];
        if (!runner) return 'NO_RUNNER_PUPPET';
        steps.push({ kind: 'walk', actor: runner.playerId, target: spot, label: 'runner-enters' });
      }
      return [steps];
    }
    case 'capture': {
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      const tagger = taggers[0];
      if (!tagger) return 'NO_TAGGER_PUPPET';
      return [
        [
          { kind: 'walk', actor: tagger.playerId, target: operatorCell, label: 'chase-operator' },
          {
            kind: 'until',
            done: (now) => subject(now, world.operatorId)?.status !== 'ACTIVE',
            label: 'captured',
          },
        ],
      ];
    }
    case 'approach': {
      const puppet = operator.role === 'tagger' ? runners[0] : taggers[0];
      if (!puppet) return 'NO_PUPPET';
      return [
        [
          {
            kind: 'walk',
            actor: puppet.playerId,
            target: operatorCell,
            adjacent: true,
            label: 'come-closer',
          },
          { kind: 'face', actor: puppet.playerId, target: operatorCell, label: 'face-operator' },
        ],
      ];
    }
    case 'exchange':
    case 'exchange-cancel': {
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      const runner = runners[0];
      if (!runner) return 'NO_RUNNER_PUPPET';
      const steps: Step[] = [
        {
          kind: 'walk',
          actor: runner.playerId,
          target: operatorCell,
          adjacent: true,
          label: 'come-closer',
        },
        { kind: 'face', actor: runner.playerId, target: operatorCell, label: 'face-operator' },
        {
          kind: 'send',
          actor: runner.playerId,
          command: () => ({
            type: 'EXCHANGE_REQUEST',
            payload: { targetPlayerId: world.operatorId },
          }),
          label: 'request-exchange',
        },
      ];
      // The plain request leaves the answer to the operator: accept, or let the 2 seconds pass.
      // The cancel variant shows the offer disappearing because the requester withdrew it.
      if (scenario === 'exchange-cancel')
        steps.push(
          ...awaitSession(runner.playerId, 'offer-pending'),
          { kind: 'wait', ticks: CANCEL_AFTER_TICKS, label: 'offer-shown' },
          {
            kind: 'send',
            actor: runner.playerId,
            command: (now) => {
              const exchangeId = now.exchanges[runner.playerId];
              return exchangeId ? { type: 'EXCHANGE_CANCEL', payload: { exchangeId } } : null;
            },
            label: 'cancel-exchange',
          },
        );
      return [steps];
    }
    case 'exchange-trace': {
      // The trace is a tagger's view: two puppet runners exchange beside the operator, and the
      // rules publish the midpoint a second later for two seconds.
      if (operator.role !== 'tagger') return 'OPERATOR_MUST_BE_TAGGER';
      const [first, second] = runners;
      if (!first || !second) return 'NEED_TWO_RUNNER_PUPPETS';
      const firstCell = (now: DemoWorld) => subject(now, first.playerId)?.cell ?? null;
      return [
        [
          {
            kind: 'walk',
            actor: first.playerId,
            target: operatorCell,
            adjacent: true,
            label: 'first-comes-closer',
          },
          {
            kind: 'walk',
            actor: second.playerId,
            target: firstCell,
            adjacent: true,
            label: 'second-joins',
          },
          {
            kind: 'send',
            actor: first.playerId,
            command: () => ({
              type: 'EXCHANGE_REQUEST',
              payload: { targetPlayerId: second.playerId },
            }),
            label: 'request-exchange',
          },
          ...awaitSession(second.playerId, 'offer-pending'),
          {
            kind: 'send',
            actor: second.playerId,
            command: (now) => {
              const exchangeId = now.exchanges[second.playerId];
              return exchangeId ? { type: 'EXCHANGE_ACCEPT', payload: { exchangeId } } : null;
            },
            label: 'accept-exchange',
          },
          { kind: 'wait', ticks: TRACE_SHOW_TICKS, label: 'trace-visible' },
        ],
      ];
    }
    case 'abort-connection-lost': {
      // Any active puppet will do: an ACTIVE participant losing its socket aborts the match.
      const puppet = [...taggers, ...runners][0];
      if (!puppet) return 'NO_PUPPET';
      return [[{ kind: 'drop', actor: puppet.playerId, label: 'drop-connection' }]];
    }
    case 'exit': {
      const runner = runners[0];
      if (!runner) return 'NO_RUNNER_PUPPET';
      const built = escapeSteps(world, runner.playerId);
      return built ? [built] : 'NO_EXIT_FOR_PUPPET';
    }
    case 'result-runner-win': {
      const escaping = runners.slice(0, 2);
      if (escaping.length < 2) return 'NEED_TWO_RUNNER_PUPPETS';
      // One track per runner: both walk to their own exit at the same time.
      const tracks: Step[][] = [];
      for (const runner of escaping) {
        const built = escapeSteps(world, runner.playerId);
        if (!built) return 'NO_EXIT_FOR_PUPPET';
        tracks.push(built);
      }
      return tracks;
    }
    case 'capture-one':
      // One capture moves the public tally (◆ 1/2) without ending the round.
      return captureTracks(taggers, runners, 1);
    default:
      // Two puppet taggers catch two puppet runners by the ordinary capture rule.
      return captureTracks(taggers, runners, 2);
  }
}

/** Puppet taggers each walk onto a puppet runner; the capture itself is the rules' verdict. */
function captureTracks(
  taggers: readonly GameSubject[],
  runners: readonly GameSubject[],
  count: number,
): Step[][] | string {
  const pairs = taggers
    .slice(0, count)
    .map((tagger, index) => ({ tagger, prey: runners[index] }))
    .filter((pair): pair is { tagger: GameSubject; prey: GameSubject } => pair.prey !== undefined);
  if (pairs.length < count) return count === 1 ? 'NEED_ONE_PAIR' : 'NEED_TWO_PAIRS';
  return pairs.map(({ tagger, prey }) => [
    {
      kind: 'walk' as const,
      actor: tagger.playerId,
      target: (now: DemoWorld) => subject(now, prey.playerId)?.cell ?? null,
      label: `capture-${prey.playerId}`,
    },
    {
      kind: 'until' as const,
      done: (now: DemoWorld) => subject(now, prey.playerId)?.status !== 'ACTIVE',
      label: `caught-${prey.playerId}`,
    },
  ]);
}

/**
 * Waits for the core to open the session on `playerId`. A request the rules refused never shows
 * up, so the wait is bounded by the offer's own lifetime instead of the general step budget.
 */
function awaitSession(playerId: string, label: string): Step[] {
  return [
    {
      kind: 'until',
      done: (now) => now.exchanges[playerId] !== undefined,
      timeout: EXCHANGE_OFFER_TICKS,
      label,
    },
  ];
}

/** Walks a runner puppet to its own exit and holds the pose until the rules accept it. */
function escapeSteps(world: DemoWorld, playerId: string): Step[] | null {
  const exit = world.exits.find((record) => record.ownerId === playerId);
  if (!exit) return null;
  return [
    { kind: 'walk', actor: playerId, target: exit.approach, label: `approach-${playerId}` },
    { kind: 'face', actor: playerId, target: exit.wall, label: `face-exit-${playerId}` },
    {
      kind: 'send',
      actor: playerId,
      command: () => ({ type: 'EXIT_START', payload: { exitId: exit.exitId } }),
      label: `start-${playerId}`,
    },
    { kind: 'wait', ticks: POSE_HOLD_TICKS, label: `hold-${playerId}` },
    {
      kind: 'send',
      actor: playerId,
      command: (now) => {
        const challengeId = now.challenges[playerId];
        return challengeId
          ? {
              type: 'EXIT_PROGRESS',
              payload: { challengeId, method: 'pose', completed: true },
            }
          : null;
      },
      label: `complete-${playerId}`,
    },
    {
      kind: 'until',
      done: (now) => subject(now, playerId)?.status !== 'ACTIVE',
      label: `escaped-${playerId}`,
    },
  ];
}
