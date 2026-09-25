/**
 * B-owned room test harness. Provides:
 *  - `FakeCore`: a deliberately small CorePort implementation used ONLY to exercise the
 *    server's tick/queue/projection boundaries. It is not A's engine and results obtained
 *    with it are recorded as LOCAL_VERIFIED, never as ACCEPTED rule integration.
 *  - fake map/practice ports shaped like A's contract for loader and practice tests.
 *  - `createTestOperatorAuth`: a test double for E's `createOperatorAuth` factory.
 *  - `bootProductApplication`: boots the real bootstrap with a product profile, a fake clock
 *    hook and real Colyseus transport so F's external tests can import it.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ActiveSelf,
  EndedSelf,
  KnownTerrain,
  PlayerKnowledge,
  VisibleEntity,
  Cell,
  WallFace,
  Dir,
  Role,
  Phase,
} from '@kkakkung/protocol/game-schema';
import type {
  ControlIntent,
  CoreCommand,
  CoreOutcome,
  CorePort,
  CoreReadFrame,
  CreateMatchInput,
  CreatePracticeInput,
  CreateOperatorAuth,
  DomainEvent,
  LayoutSelectionPort,
  LayoutTemplate,
  MapPreparationPort,
  MatchLayout,
  MatchTuning,
  MediaIntent,
  PracticeLayoutPort,
  StepResult,
  Topology,
} from '../../src/game/ports.js';
import { createApplication, type ProductProfile } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';

export const testTuning: MatchTuning = {
  tuningVersion: 'test-tuning-1',
  tickMs: 50,
  moveTicks: 9,
  turnTicks: 6,
  grabTicks: 6,
  roundTicks: 3600,
  installationTicks: 10,
  armTicks: 20,
  restraintTicks: 60,
  restraintImmunityTicks: 40,
  exchangeExpiryTicks: 80,
  traceDelayTicks: 20,
  traceVisibleTicks: 40,
  exitMinimumTicks: 40,
  exitExpiryTicks: 160,
  exitRetryTicks: 10,
};

export function openTopology(width = 32, height = 32): Topology {
  return {
    topologyVersion: 'test-topology-1',
    width,
    height,
    walkable: Array.from({ length: width * height }, (_, i) => {
      const x = i % width;
      const y = Math.floor(i / width);
      return x > 0 && x < width - 1 && y > 0 && y < height - 1;
    }),
  };
}

const DIRS: Record<Dir, { dx: number; dy: number }> = {
  0: { dx: 0, dy: -1 },
  1: { dx: 1, dy: 0 },
  2: { dx: 0, dy: 1 },
  3: { dx: -1, dy: 0 },
};

export type FakePlayer = {
  playerId: string;
  role: Role;
  status: 'ACTIVE' | 'ESCAPED' | 'CAPTURED';
  cell: Cell;
  dir: Dir;
  visited: Set<string>;
  exits: MatchLayout['exits'];
};

export type FakeState = {
  matchId: string;
  gameInstanceId: string;
  kind: 'practice' | 'game';
  phase: Phase;
  tick: number;
  startTick: number | null;
  topology: Topology;
  players: Map<string, FakePlayer>;
  abortReason: CoreReadFrame['abortReason'];
  result: CoreReadFrame['result'];
  exits: MatchLayout['exits'];
  sensors: { id: string; ownerId: string; cell: Cell; wall: WallFace }[];
};

export type FakeCoreOptions = {
  /** Commands of these types are rejected with the given code (simulates rule refusals). */
  reject?: Partial<Record<CoreCommand['type'], CoreOutcome['code']>>;
  /** Drop or duplicate outcomes to test the driver's integrity checks. */
  corruptOutcomes?: 'drop' | 'duplicate' | null;
  /** Emits a footstep SPATIAL_SOUND and a HUNTER_MARKER for taggers on every applied move. */
  emitEvents?: boolean;
  /** Ends the match with the given result when a player escapes twice. */
  endOnEscapes?: boolean;
  /**
   * Throws from `getFrame` while this returns true, so the owning room's tick fails the way A's
   * core did in QA-10 (a thrown read reached the interval callback and killed the process).
   */
  failGetFrame?: () => boolean;
};

export class FakeCore implements CorePort<FakeState> {
  readonly calls: { method: string; args: unknown }[] = [];
  constructor(readonly options: FakeCoreOptions = {}) {}

  createMatch(input: CreateMatchInput): FakeState {
    this.calls.push({ method: 'createMatch', args: input });
    return this.build(input, 'game', 'GAME_LOADING');
  }

  createPractice(input: CreatePracticeInput): FakeState {
    this.calls.push({ method: 'createPractice', args: input });
    return this.build(input, 'practice', 'TEAM_PRACTICE');
  }

  private build(input: CreateMatchInput, kind: 'practice' | 'game', phase: Phase): FakeState {
    const players = new Map<string, FakePlayer>();
    for (const p of input.players) {
      const placed = input.layout.players.find((l) => l.playerId === p.playerId);
      const cell = placed?.cell ?? { x: 1 + players.size, y: 1 };
      players.set(p.playerId, {
        playerId: p.playerId,
        role: p.role,
        status: 'ACTIVE',
        cell,
        dir: placed?.dir ?? 2,
        visited: new Set([`${cell.x},${cell.y}`]),
        exits: input.layout.exits.filter((e) => e.ownerId === p.playerId),
      });
    }
    return {
      matchId: input.matchId,
      gameInstanceId: input.gameInstanceId,
      kind,
      phase,
      tick: 0,
      startTick: null,
      topology: input.layout.topology,
      players,
      abortReason: null,
      result: null,
      exits: kind === 'game' ? input.layout.exits : [],
      sensors: [],
    };
  }

  stepMatch(
    state: FakeState,
    input: { tick: number; commands: readonly CoreCommand[]; controls: readonly ControlIntent[] },
  ): StepResult<FakeState> {
    this.calls.push({ method: 'stepMatch', args: input });
    const next: FakeState = {
      ...state,
      tick: input.tick,
      players: new Map(
        [...state.players].map(([id, p]) => [id, { ...p, visited: new Set(p.visited) }]),
      ),
    };
    const outcomes: CoreOutcome[] = [];
    const events: DomainEvent[] = [];
    const mediaIntents: MediaIntent[] = [];
    for (const control of input.controls) {
      if (control.type === 'START_PLAYING' && next.startTick === null) {
        next.startTick = control.startTick;
        next.phase = 'PLAYING';
      } else if (control.type === 'ABORT_MATCH' && !next.abortReason) {
        next.abortReason = control.reason;
        next.phase = 'ABORTED';
        mediaIntents.push({ type: 'RETIRE_INSTANCE', reason: 'aborted' });
      } else if (control.type === 'CONNECTION_LOST') {
        const player = next.players.get(control.playerId);
        if (
          player &&
          player.status === 'ACTIVE' &&
          player.role === 'runner' &&
          next.kind === 'game'
        ) {
          player.status = 'CAPTURED';
          mediaIntents.push({
            type: 'RETIRE_PLAYER',
            playerId: player.playerId,
            reason: 'connection-lost',
          });
        }
      }
    }
    for (const command of input.commands) {
      const base = {
        matchId: command.matchId,
        requestId: command.requestId,
        sequence: command.sequence,
        tick: input.tick,
        actorId: command.actorId,
      };
      const forced = this.options.reject?.[command.type];
      const player = next.players.get(command.actorId);
      if (forced) {
        outcomes.push({ ...base, result: 'rejected', code: forced });
        continue;
      }
      if (!player || player.status !== 'ACTIVE') {
        outcomes.push({ ...base, result: 'rejected', code: 'NOT_ACTIVE' });
        continue;
      }
      if (next.kind === 'game' && next.phase !== 'PLAYING') {
        outcomes.push({ ...base, result: 'rejected', code: 'INVALID_PHASE' });
        continue;
      }
      if (command.type === 'MOVE_INTENT') {
        if (command.payload.direction === null) {
          outcomes.push({ ...base, result: 'applied', code: null });
          continue;
        }
        const sign = command.payload.direction === 'forward' ? 1 : -1;
        const vector = DIRS[player.dir];
        const target = { x: player.cell.x + vector.dx * sign, y: player.cell.y + vector.dy * sign };
        const walkable = next.topology.walkable[target.y * next.topology.width + target.x] === true;
        if (!walkable) {
          outcomes.push({ ...base, result: 'rejected', code: 'NOT_ALLOWED' });
          continue;
        }
        player.cell = target;
        player.visited.add(`${target.x},${target.y}`);
        outcomes.push({ ...base, result: 'applied', code: null });
        if (this.options.emitEvents) {
          events.push({
            type: 'SPATIAL_SOUND',
            sound: {
              eventId: `step-${command.requestId}`,
              tick: input.tick,
              kind: 'footstep',
              cell: target,
              sourcePlayerId: player.playerId,
            },
          });
          const taggers = [...next.players.values()]
            .filter((p) => p.role === 'tagger')
            .map((p) => p.playerId);
          events.push({
            eventId: `marker-${command.requestId}`,
            tick: input.tick,
            audience: taggers,
            type: 'HUNTER_MARKER',
            payload: {
              markerId: `m-${command.sequence}`,
              kind: 'exchange',
              point: { x: target.x, y: target.y },
              occurredTick: input.tick,
              showAtTick: input.tick + 20,
              expiresTick: input.tick + 200,
            },
          });
        }
      } else if (command.type === 'TURN') {
        player.dir = ((player.dir + (command.payload.direction === 'right' ? 1 : 3)) % 4) as Dir;
        outcomes.push({ ...base, result: 'applied', code: null });
      } else if (
        command.type === 'EXIT_PROGRESS' &&
        command.payload.completed &&
        next.kind === 'game'
      ) {
        player.status = 'ESCAPED';
        mediaIntents.push({
          type: 'RETIRE_PLAYER',
          playerId: player.playerId,
          reason: 'personal-ended',
        });
        outcomes.push({ ...base, result: 'applied', code: null });
        if (this.options.endOnEscapes) {
          const escaped = [...next.players.values()].filter((p) => p.status === 'ESCAPED').length;
          if (escaped >= 2) {
            next.result = { winner: 'runners', reason: 'two-escaped' };
            next.phase = 'RESULT';
            mediaIntents.push({ type: 'RETIRE_INSTANCE', reason: 'round-ended' });
          }
        }
      } else if (command.type === 'INSTALL' && player.role === 'tagger') {
        next.sensors = [
          ...next.sensors,
          {
            id: `sensor-${command.sequence}`,
            ownerId: player.playerId,
            cell: player.cell,
            wall: { x: player.cell.x, y: player.cell.y - 1, side: 2 },
          },
        ];
        outcomes.push({ ...base, result: 'applied', code: null });
      } else {
        outcomes.push({ ...base, result: 'rejected', code: 'NOT_ALLOWED' });
      }
    }
    if (this.options.corruptOutcomes === 'drop' && outcomes.length) outcomes.pop();
    if (this.options.corruptOutcomes === 'duplicate' && outcomes[0]) outcomes.push(outcomes[0]);
    return { state: next, outcomes, events, mediaIntents };
  }

  getPlayerKnowledge(state: FakeState, playerId: string): PlayerKnowledge {
    const player = state.players.get(playerId);
    if (!player) return { mapVersion: 0, knownTerrain: [], knownActiveExits: [] };
    const knownTerrain: KnownTerrain[] = [...player.visited].map((key) => {
      const [x, y] = key.split(',').map(Number) as [number, number];
      return { x, y, kind: 'floor' };
    });
    return { mapVersion: player.visited.size, knownTerrain, knownActiveExits: player.exits };
  }

  getVisibleEntities(state: FakeState, playerId: string): readonly VisibleEntity[] {
    const self = state.players.get(playerId);
    if (!self) return [];
    const out: VisibleEntity[] = [];
    for (const other of state.players.values()) {
      if (other.playerId === playerId || other.status !== 'ACTIVE') continue;
      if (Math.abs(other.cell.x - self.cell.x) + Math.abs(other.cell.y - self.cell.y) <= 2)
        out.push({
          id: other.playerId,
          kind: 'player',
          cell: other.cell,
          dir: other.dir,
          action: null,
          role: other.role,
        });
    }
    for (const sensor of state.sensors)
      if (Math.abs(sensor.cell.x - self.cell.x) + Math.abs(sensor.cell.y - self.cell.y) <= 2)
        out.push({
          id: sensor.id,
          kind: 'sensor',
          cell: sensor.cell,
          wall: sensor.wall,
          state: 'ARMED',
        });
    return out;
  }

  getPlayerSelf(state: FakeState, playerId: string): ActiveSelf | EndedSelf | null {
    const player = state.players.get(playerId);
    if (!player) return null;
    if (player.status !== 'ACTIVE') return { playerId, role: player.role, status: player.status };
    return {
      playerId,
      role: player.role,
      status: 'ACTIVE',
      cell: player.cell,
      dir: player.dir,
      action: null,
      equipment: {
        sensor: player.role === 'tagger' ? 1 : 0,
        trap: player.role === 'tagger' ? 1 : 0,
      },
      ownedEquipment: state.sensors
        .filter((s) => s.ownerId === playerId)
        .map((s) => ({
          equipmentId: s.id,
          kind: 'sensor' as const,
          cell: s.cell,
          wall: s.wall,
          state: 'ARMED' as const,
          armedTick: 0,
        })),
      restraintUntilTick: null,
      restraintImmuneUntilTick: null,
      installation: null,
      exchange: null,
      challenge: null,
      loading: null,
    };
  }

  getVisibleSurfaces(state: FakeState, playerId: string) {
    const player = state.players.get(playerId);
    if (!player) return { visibleCells: [], visibleWallFaces: [] };
    return {
      visibleCells: [player.cell],
      visibleWallFaces: [{ ...player.cell, side: player.dir }],
    };
  }

  getFrame(state: FakeState): CoreReadFrame {
    if (this.options.failGetFrame?.()) throw new Error('FAKE_CORE_TICK_FAULT');
    const players = [...state.players.values()];
    return {
      matchId: state.matchId,
      gameInstanceId: state.gameInstanceId,
      tick: state.tick,
      phase: state.phase,
      counts: {
        escaped: players.filter((p) => p.status === 'ESCAPED').length,
        captured: players.filter((p) => p.status === 'CAPTURED').length,
      },
      result: state.result,
      abortReason: state.abortReason,
      participants: players.map((p) => ({
        playerId: p.playerId,
        role: p.role,
        status: p.status,
        cell: p.cell,
        dir: p.dir,
        action: null,
      })),
    };
  }
}

export function layoutFor(
  players: readonly { playerId: string; role: Role }[],
  topology = openTopology(),
): MatchLayout {
  let runners = 0;
  let taggers = 0;
  // Positions scale with the topology so small practice maps stay inside walkable cells.
  const step = topology.width >= 32 ? 10 : 2;
  const runnerRow = topology.height >= 32 ? 24 : topology.height - 3;
  const taggerRow = topology.height >= 32 ? 4 : 2;
  const placed = players.map((p) => {
    if (p.role === 'runner')
      return {
        ...p,
        cell: { x: 1 + (topology.width >= 32 ? 2 : 0) + runners++ * step, y: runnerRow },
        dir: 0 as Dir,
      };
    return {
      ...p,
      cell: { x: 1 + (topology.width >= 32 ? 2 : 0) + taggers++ * step, y: taggerRow },
      dir: 2 as Dir,
    };
  });
  const exits = placed
    .filter((p) => p.role === 'runner')
    .map((p, i) => ({
      exitId: `exit-${p.playerId}`,
      ownerId: p.playerId,
      wall: { x: p.cell.x, y: 0, side: 2 as Dir },
      approach: { x: p.cell.x, y: 1 },
      poseKind: (['left', 'right', 'y'] as const)[i % 3]!,
    }));
  return {
    layoutId: `layout-${randomUUID()}`,
    topology,
    players: placed,
    exits,
    territories: placed
      .filter((p) => p.role === 'tagger')
      .map((p) => ({ playerId: p.playerId, cells: [p.cell] })),
  };
}

/** Test doubles for A's map ports. `failOnline` makes the selector yield failures only. */
export function fakeMapPorts(
  options: {
    failOnline?: boolean;
    batch?: number;
    certifyFallback?: boolean;
    variants?: number;
  } = {},
) {
  const calls: string[] = [];
  const maps: MapPreparationPort = {
    validateTemplate(raw, source) {
      calls.push('validateTemplate');
      if (typeof raw !== 'object' || raw === null || !('regions' in raw))
        return { status: 'invalid', code: 'INVALID_TEMPLATE', path: ['regions'] };
      const region = (id: string) => ({
        regionId: id,
        cells: [{ x: 3, y: 4 }],
        spawnCandidates: [{ x: 3, y: 4 }],
      });
      return {
        status: 'valid',
        template: {
          ...source,
          topology: openTopology(),
          taggerRegions: [region('t1'), region('t2'), region('t3')],
          runnerSpawnRegions: [region('r1'), region('r2'), region('r3')],
          exitCandidates: [{ x: 3, y: 0, side: 2 }],
        },
      };
    },
    createTemplateVariants(template) {
      calls.push('createTemplateVariants');
      const count = options.variants ?? 3;
      const variants: LayoutTemplate[] = Array.from({ length: count }, (_, i) => ({
        ...template,
        variantId: `r${i}`,
      })).reverse();
      return { status: 'valid', variants };
    },
  };
  const selection: LayoutSelectionPort = {
    certifyFallback(input) {
      calls.push('certifyFallback');
      if (options.certifyFallback === false)
        return { status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' };
      const slots = input.fallback.layout.players.map((p) => p.playerId);
      const sorted = [...input.players].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
      const mapping = new Map<string, string>();
      for (const role of ['tagger', 'runner'] as const)
        sorted
          .filter((p) => p.role === role)
          .forEach((p, i) => mapping.set(`${role}-${i + 1}`, p.playerId));
      if (slots.some((s) => !mapping.has(s)))
        return { status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' };
      const layout = input.fallback.layout;
      return {
        status: 'selected',
        source: 'fallback',
        layout: {
          ...layout,
          players: layout.players.map((p) => ({ ...p, playerId: mapping.get(p.playerId)! })),
          exits: layout.exits.map((e) => ({ ...e, ownerId: mapping.get(e.ownerId)! })),
          territories: layout.territories.map((t) => ({
            ...t,
            playerId: mapping.get(t.playerId)!,
          })),
        },
      };
    },
    *selectWithFallback(input) {
      calls.push('selectWithFallback');
      const batch = options.batch ?? 8;
      let attempted = 0;
      while (attempted < input.maxAttempts) {
        attempted += batch;
        yield { attempted, batchAttempts: batch };
        if (!options.failOnline)
          return {
            status: 'selected',
            source: 'online',
            layout: layoutFor(input.players, input.template.topology),
          };
      }
      return { status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' };
    },
  };
  return { maps, selection, calls };
}

export function fallbackFileFor(source: {
  templateId: string;
  templateVersion: string;
  templateHash: string;
  variantId: string;
}) {
  const slots = [
    { playerId: 'tagger-1', role: 'tagger' as const },
    { playerId: 'tagger-2', role: 'tagger' as const },
    { playerId: 'tagger-3', role: 'tagger' as const },
    { playerId: 'runner-1', role: 'runner' as const },
    { playerId: 'runner-2', role: 'runner' as const },
    { playerId: 'runner-3', role: 'runner' as const },
  ];
  return { ...source, layout: layoutFor(slots) };
}

export const fakePracticePort: PracticeLayoutPort = {
  preparePracticeLayout(raw, players, role) {
    const versioned =
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { practiceVersion?: unknown }).practiceVersion === 'string';
    if (
      !versioned ||
      players.length === 0 ||
      players.length > 3 ||
      players.some((p) => p.role !== role)
    )
      return { status: 'invalid', code: 'INVALID_PRACTICE_LAYOUT', path: ['layouts', role] };
    return { status: 'ready', layout: { ...layoutFor(players, openTopology(8, 8)), exits: [] } };
  },
};

/** Test double for E's operator auth factory: constant-time Bearer comparison. */
export const createTestOperatorAuth: CreateOperatorAuth = (token) => (authorization) => {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const presented = Buffer.from(authorization.slice(7), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
};

export type FakeClock = {
  now: () => number;
  advance: (ms: number) => void;
  set: (ms: number) => void;
};
export function fakeClock(start = 0): FakeClock {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms), set: (ms) => (current = ms) };
}

export const TEST_OPS_TOKEN = 'test-ops-token-not-a-secret';

export function productProfile(
  overrides: Partial<ProductProfile<FakeState>> = {},
): ProductProfile<FakeState> {
  const core = new FakeCore({ endOnEscapes: true });
  const ports = fakeMapPorts();
  const base: ProductProfile<FakeState> = {
    serverEpoch: 'epoch-test',
    maxRooms: 3,
    inviteMaxTtlMs: 60 * 60_000,
    publicWindow: { opensAtEpochMs: 0, closesAtEpochMs: 4_000_000_000_000 },
    sessionAttempts: { windowMs: 60_000, perInvite: 20, perIp: 100 },
    roomIdleTtlMs: 10 * 60_000,
    trustProxy: false,
    opsToken: TEST_OPS_TOKEN,
    createOperatorAuth: createTestOperatorAuth,
    createMediaCoordinator: null,
    mediaConfig: null,
    core,
    tuning: testTuning,
    practice: { port: fakePracticePort, raw: { practiceVersion: 'practice-test-1' } },
    layouts: {
      maps: ports.maps,
      selection: ports.selection,
      masterPath: '',
      fallbackPath: '',
      templateId: 'test-template',
      templateVersion: 'v1',
    },
    developmentAdmission: () => 'OPEN',
    assetVersion: 'assets-test-1',
    random: () => 0.5,
  };
  return { ...base, ...overrides };
}

/** Writes a master template and matching fallback file so the real loader path can run. */
export async function writeLayoutFiles(directory: string) {
  await mkdir(directory, { recursive: true });
  const masterBytes = Buffer.from(JSON.stringify({ regions: true, note: 'test master' }), 'utf8');
  const templateHash = createHash('sha256').update(masterBytes).digest('hex');
  const masterPath = join(directory, 'master.json');
  const fallbackPath = join(directory, 'fallback.json');
  await writeFile(masterPath, masterBytes);
  const fallbacks = ['r0', 'r1', 'r2'].map((variantId) =>
    fallbackFileFor({
      templateId: 'test-template',
      templateVersion: 'v1',
      templateHash,
      variantId,
    }),
  );
  await writeFile(fallbackPath, JSON.stringify(fallbacks), 'utf8');
  return { masterPath, fallbackPath, templateHash };
}

/** Boots the real bootstrap with a product profile on an ephemeral port. */
export async function bootProductApplication(overrides: Partial<ProductProfile<FakeState>> = {}) {
  const profile = productProfile(overrides);
  const application = createApplication<FakeState>(
    { ...parseConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }), port: 0 },
    profile,
  );
  const port = await application.listen();
  return { application, profile, port, endpoint: `http://127.0.0.1:${port}` };
}
