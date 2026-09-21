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
  // 배치(S15P21C204-316 제어). 걷지 않고 확인하고 싶은 자리로 곧장 간다.
  'place-me-at-exit',
  'place-puppet',
  // 다가오기·시야
  'approach',
  'cross-my-view',
  'turn-before-me',
  // 술래 장비
  'trap',
  'sensor',
  'device-states',
  'double-trap-immunity',
  // 포획·구속
  'capture',
  'capture-one',
  'capture-in-challenge',
  'caught-in-my-challenge',
  // 출구·탈출
  'exit',
  // 지도 교환
  'exchange',
  'exchange-cancel',
  'accept-my-exchange',
  'exchange-trace',
  // 관전·결과
  'spectate-then-capture',
  'result-tagger-win',
  'result-runner-win',
  'abort-connection-lost',
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

/**
 * S15P21C204-317. 같은 대본을 조금씩 달리 돌리기 위한 선택지. 없는 값은 시나리오별 기본값을
 * 쓴다. 시나리오가 받지 않는 키가 오면 `UNSUPPORTED_OPTION` 으로 거절해, 버튼이 실제로는
 * 무시되는 설정을 켜 놓은 것처럼 보이지 않게 한다.
 */
export type DemoScenarioOptions = Readonly<{
  /** 어느 역할의 인형을 쓸지. 기본은 시나리오가 정한다. */
  role?: Role;
  /** 관리자에게서 몇 칸 떨어진 자리인지. */
  distance?: 1 | 2 | 3;
  /** 관리자의 바라보는 방향 기준으로 어느 쪽인지. */
  side?: 'front' | 'left' | 'right' | 'back';
  /** 인형이 관리자를 보게 할지 등지게 할지. */
  facing?: 'toward' | 'away';
  /** 장비를 인형이 놓을지 관리자가 놓을지. */
  installer?: 'puppet' | 'me';
}>;

export type DemoOptionKey = keyof DemoScenarioOptions;

/** 각 시나리오가 실제로 읽는 선택지. 여기 없는 키는 거절한다. */
export const SCENARIO_OPTIONS: Readonly<Record<DemoScenario, readonly DemoOptionKey[]>> =
  Object.freeze({
    'place-me-at-exit': [],
    'place-puppet': ['role', 'side', 'distance', 'facing'],
    approach: ['role', 'distance'],
    'cross-my-view': ['role'],
    'turn-before-me': ['role', 'distance'],
    trap: ['installer'],
    sensor: ['installer'],
    'device-states': [],
    'double-trap-immunity': [],
    capture: [],
    'capture-one': [],
    'capture-in-challenge': [],
    'caught-in-my-challenge': [],
    exit: [],
    exchange: [],
    'exchange-cancel': [],
    'accept-my-exchange': [],
    'exchange-trace': [],
    'spectate-then-capture': [],
    'result-tagger-win': [],
    'result-runner-win': [],
    'abort-connection-lost': [],
  });

/**
 * 시나리오를 시작할 수 없는 이유. 전부 세계의 상태나 선택지 때문이며, 버튼을 누르기 전에
 * 판정된다. 웹이 이 코드에 한국어 라벨을 붙인다.
 */
export const DEMO_REJECTIONS = [
  'OPERATOR_NOT_ACTIVE',
  'NO_OPERATOR_STATE',
  'OPERATOR_MUST_BE_RUNNER',
  'OPERATOR_MUST_BE_TAGGER',
  'NO_OPERATOR_EXIT',
  'NO_PUPPET',
  'NO_TAGGER_PUPPET',
  'NO_RUNNER_PUPPET',
  'NEED_TWO_RUNNER_PUPPETS',
  'NEED_ONE_PAIR',
  'NEED_TWO_PAIRS',
  'NO_EXIT_FOR_PUPPET',
  'NO_ROOM_TO_INSTALL',
  'NO_WALL_TO_MOUNT',
  'NO_ROOM_TO_RETREAT',
  'NO_ROOM_FOR_TWO_TRAPS',
  'CELL_UNAVAILABLE',
  'NO_CROSSING_PATH',
  'UNSUPPORTED_OPTION',
] as const;
export type DemoRejection = (typeof DEMO_REJECTIONS)[number];

/**
 * 단계가 끝나지 못한 이유. 진행 중 실패는 `<단계>:<이유>` 로 보고한다.
 * `TIMEOUT` 은 상한을 넘긴 것이고 `FAILED` 는 규칙이 그 동작을 거절한 것이다.
 */
export const DEMO_FAILURE_REASONS = [
  'TIMEOUT',
  'FAILED',
  'NO_INSTALL_FROM_OPERATOR',
  'NO_REQUEST_FROM_OPERATOR',
  'NO_CHALLENGE_FROM_OPERATOR',
] as const;
export type DemoFailureReason = (typeof DEMO_FAILURE_REASONS)[number];

export type DemoExit = Readonly<{ exitId: string; ownerId: string; approach: Cell; wall: Cell }>;

/**
 * S15P21C204-317. 관리자가 주도하는 대본이 기다리는 상태. 내가 놓은 장비가 무장됐는지, 내가
 * 도전을 시작했는지, 내 교환 요청이 열렸는지를 보고 인형이 반응한다.
 *
 * 방(S15P21C204-318)이 채우기 전까지는 비어 있으므로 **선택 필드**다. 없으면 관리자 주도
 * 대본이 `NO_OPERATOR_STATE` 로 거절해, 반쯤 동작하는 버튼을 보여 주지 않는다.
 */
export type DemoOperatorState = Readonly<{
  installations: readonly Readonly<{
    kind: 'sensor' | 'trap';
    cell: Cell;
    state: 'UNARMED' | 'ARMED' | 'SPENT';
  }>[];
  challengeId: string | null;
  exchangeId: string | null;
  /** 관리자가 도망자일 때 자기 출구. 술래면 null. */
  exit: DemoExit | null;
}>;

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
  /** S15P21C204-317. 관리자 주도 대본이 읽는다. 방이 채우기 전에는 없다. */
  operator?: DemoOperatorState;
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
/**
 * A step that cannot finish is abandoned rather than left blocking the room.
 *
 * S15P21C204-302. 1200 was calibrated on the open grid, where a puppet reaches the operator in
 * 332-520 ticks. On the corridor maze that is now the default the same walk costs 368-1072 ticks
 * and a tagger's chase up to 1136, so the old budget failed 'exchange' with come-closer:TIMEOUT
 * on the long variants. 2400 keeps more than twice the worst measured optimal path and still
 * reports a genuinely stuck puppet well inside the 3600-tick round.
 */
export const STEP_TIMEOUT_TICKS = 2400;
/** Installation (10) plus arming (20) with room to spare: the device must be live to be shown. */
const ARM_WAIT_TICKS = 60;
/** The rules require the pose to stand for two seconds before a report can succeed. */
const POSE_HOLD_TICKS = 50;
/** An exchange offer lives 2 seconds (40 ticks); a session that never appears was refused. */
const EXCHANGE_OFFER_TICKS = 40;
/** A trace shows 1 second after the exchange and stays 2 seconds: the scenario waits it out. */
const TRACE_SHOW_TICKS = 60;
/** S15P21C204-317. 인형이 도전을 붙들고 있는 동안 관리자가 걸어와 밟을 시간. */
const CHALLENGE_HOLD_TICKS = 400;
/** Long enough for the operator to see an incoming offer before the puppet withdraws it. */
const CANCEL_AFTER_TICKS = 20;

type Target = Cell | ((world: DemoWorld) => Cell | null);

type Step =
  /** `stopWithin` cells from the target is close enough; 0 means the target cell itself. */
  | { kind: 'walk'; actor: string; target: Target; stopWithin?: number; label: string }
  | { kind: 'face'; actor: string; target: Target; label: string }
  | {
      kind: 'send';
      actor: string;
      command: (world: DemoWorld) => PuppetCommand | null;
      label: string;
    }
  | { kind: 'wait'; ticks: number; label: string }
  /**
   * Waits for a condition. S15P21C204-317 added `failure`: a step that waits for the operator
   * reports what the operator did not do, rather than a bare TIMEOUT.
   */
  | {
      kind: 'until';
      done: (world: DemoWorld) => boolean;
      timeout?: number;
      failure?: DemoFailureReason;
      label: string;
    }
  /** S15P21C204-316/317. Puts a participant on a cell without walking there. */
  | {
      kind: 'place';
      actor: string;
      target: Target;
      dir: (world: DemoWorld) => Dir | null;
      label: string;
    }
  /** The room drops the puppet's connection as if its socket died: a rules-owned abort. */
  | { kind: 'drop'; actor: string; label: string };

export type DemoIo = Readonly<{
  send: (actor: string, command: PuppetCommand) => boolean;
  /** Absent when the room cannot drop puppets; a `drop` step then fails instead of blocking. */
  drop?: (actor: string) => boolean;
  /**
   * S15P21C204-316. Asks the room for a `PLACE_PLAYER` control. Absent when the room cannot
   * place, so a `place` step fails rather than waiting forever. The core refuses silently, so
   * the step confirms by reading the position back on the next tick.
   */
  place?: (actor: string, cell: Cell, dir: Dir) => boolean;
}>;

export interface DemoRunner {
  /** Starts a scenario, replacing whatever was running. Returns the rejection reason, or null. */
  start(
    scenario: DemoScenario,
    world: DemoWorld,
    options?: DemoScenarioOptions,
  ): DemoRejection | null;
  /** One room tick. Emits at most one command per step through `send`. */
  advance(world: DemoWorld, io: DemoIo | DemoIo['send']): void;
  stop(): void;
  readonly status: DemoStatus;
}

/**
 * The scenarios that can start in this world: what the operator's role and the puppets allow.
 * Judged with default options, so a button appears when at least one setting of it can run.
 */
export function availableScenarios(world: DemoWorld): DemoScenario[] {
  return DEMO_SCENARIOS.filter((scenario) => typeof build(scenario, world, {}) !== 'string');
}

/** Why the options do not fit this scenario, or null. */
function checkOptions(scenario: DemoScenario, options: DemoScenarioOptions): DemoRejection | null {
  const allowed = SCENARIO_OPTIONS[scenario];
  for (const key of Object.keys(options) as DemoOptionKey[]) {
    if (options[key] === undefined) continue;
    if (!allowed.includes(key)) return 'UNSUPPORTED_OPTION';
  }
  if (options.distance !== undefined && ![1, 2, 3].includes(options.distance))
    return 'UNSUPPORTED_OPTION';
  return null;
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
    start(next, world, options = {}) {
      const unsupported = checkOptions(next, options);
      if (unsupported) return unsupported;
      const built = build(next, world, options);
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
        if (elapsed > budget) {
          // A wait on the operator says what was not done, instead of a bare timeout.
          const reason = step.kind === 'until' ? (step.failure ?? 'TIMEOUT') : 'TIMEOUT';
          return finish(`${step.label}:${reason}`);
        }
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
  { send, drop, place }: DemoIo,
  elapsed: number,
  releasing: Set<string>,
): 'done' | 'running' | 'failed' {
  if (step.kind === 'wait') return elapsed >= step.ticks ? 'done' : 'running';
  if (step.kind === 'until') return step.done(world) ? 'done' : 'running';
  const actor = subject(world, step.actor);
  if (!actor || actor.status !== 'ACTIVE') return 'failed';
  if (step.kind === 'place') {
    const target = typeof step.target === 'function' ? step.target(world) : step.target;
    const dir = step.dir(world);
    if (!target || dir === null || !place) return 'failed';
    // The core refuses silently, so the arrival is confirmed by reading the position back on a
    // later tick rather than by the return value, which only says the room took the request.
    if (sameCell(actor.cell, target) && actor.dir === dir) return 'done';
    return place(step.actor, target, dir) ? 'running' : 'failed';
  }
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
  return walk(actor, target, step.stopWithin ?? 0, world, send, releasing);
}

/**
 * Emits the turn that brings the actor one quarter closer to `target`, or null when it faces it.
 * S15P21C204-317. Reads the direction by the larger axis, so a `face` step also works on a target
 * that is not adjacent: `approach` and `turn-before-me` now stop several cells away.
 */
function turnToward(
  actor: GameSubject,
  target: Cell,
  send: (actor: string, command: PuppetCommand) => boolean,
): 'running' | 'failed' | null {
  const desired = facingDirection(actor.cell, target);
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
  stopWithin: number,
  world: DemoWorld,
  send: (actor: string, command: PuppetCommand) => boolean,
  releasing: Set<string>,
): 'done' | 'running' | 'failed' {
  if (sameCell(actor.cell, target)) return 'done';
  const next = pathStep(world, actor, target, stopWithin);
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
  stopWithin: number,
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
  if (here <= stopWithin) return 'arrived';
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

/**
 * S15P21C204-317. The cell `distance` steps to one side of `from`, in a straight line, read in
 * the direction it is facing. A demo places relative to what the operator sees, not to the grid.
 * Null when the line leaves the passages before it gets there.
 */
function relativeCell(
  world: DemoWorld,
  from: GameSubject,
  side: 'front' | 'left' | 'right' | 'back',
  distance: number,
): Cell | null {
  const turns = { front: 0, right: 1, back: 2, left: 3 }[side];
  const vector = DIRECTIONS[((from.dir + turns) % 4) as Dir]!;
  let cell: Cell = from.cell;
  for (let step = 0; step < distance; step += 1) {
    const next = { x: cell.x + vector.dx, y: cell.y + vector.dy };
    if (!isWalkable(world.topology, next)) return null;
    cell = next;
  }
  return sameCell(cell, from.cell) ? null : cell;
}

/** The direction that looks from `cell` toward `target`, by the larger axis. */
function facingDirection(cell: Cell, target: Cell): Dir | null {
  const dx = target.x - cell.x;
  const dy = target.y - cell.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return (dx > 0 ? 1 : 3) as Dir;
  return (dy > 0 ? 2 : 0) as Dir;
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
function build(
  scenario: DemoScenario,
  world: DemoWorld,
  options: DemoScenarioOptions,
): Step[][] | DemoRejection {
  const operator = subject(world, world.operatorId);
  if (!operator || operator.status !== 'ACTIVE') return 'OPERATOR_NOT_ACTIVE';
  const taggers = puppetsOf(world, 'tagger');
  const runners = puppetsOf(world, 'runner');
  // Re-read each tick so a puppet follows an operator who keeps moving.
  const operatorCell = (now: DemoWorld) => subject(now, world.operatorId)?.cell ?? null;
  /** S15P21C204-317. Puppets of the asked-for role, defaulting to the operator's opposite. */
  const puppetsFor = (fallback: Role) =>
    (options.role ?? fallback) === 'tagger' ? taggers : runners;
  const opposite: Role = operator.role === 'tagger' ? 'runner' : 'tagger';

  switch (scenario) {
    case 'place-me-at-exit': {
      // 걸어가지 않고 내 출구 앞에 선다. 도전·자세·탈출·출구 닫힘을 바로 확인할 수 있다.
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      if (!world.operator) return 'NO_OPERATOR_STATE';
      const exit = world.operator.exit;
      if (!exit) return 'NO_OPERATOR_EXIT';
      return [
        [
          {
            kind: 'place',
            actor: world.operatorId,
            target: exit.approach,
            // 출구 벽면을 바라봐야 도전을 시작할 수 있다.
            dir: () => directionTo(exit.approach, exit.wall),
            label: 'place-at-exit',
          },
        ],
      ];
    }
    case 'place-puppet': {
      // 거리별로 상대가 어떻게 보이는지 확인한다. 걷지 않으므로 안개·크기·실루엣만 본다.
      const pool = puppetsFor(opposite);
      const puppet = pool[0];
      if (!puppet) return 'NO_PUPPET';
      const spot = relativeCell(world, operator, options.side ?? 'front', options.distance ?? 2);
      if (!spot || !isFree(world, spot)) return 'CELL_UNAVAILABLE';
      const away = options.facing === 'away';
      return [
        [
          {
            kind: 'place',
            actor: puppet.playerId,
            target: spot,
            dir: (now) => {
              const me = subject(now, world.operatorId);
              if (!me) return null;
              const toward = facingDirection(spot, me.cell);
              if (toward === null) return null;
              return (away ? (toward + 2) % 4 : toward) as Dir;
            },
            label: 'place-puppet',
          },
        ],
      ];
    }
    case 'cross-my-view': {
      // 한쪽 옆에서 반대쪽 옆으로 지나간다. 시야 안팎 전환과 이동 보간을 본다.
      const puppet = puppetsFor(opposite)[0];
      if (!puppet) return 'NO_PUPPET';
      const from = relativeCell(world, operator, 'left', 2);
      const to = relativeCell(world, operator, 'right', 2);
      if (!from || !to || !isFree(world, from) || !isFree(world, to)) return 'NO_CROSSING_PATH';
      return [
        [
          { kind: 'walk', actor: puppet.playerId, target: from, label: 'move-to-side' },
          { kind: 'walk', actor: puppet.playerId, target: to, label: 'cross' },
        ],
      ];
    }
    case 'turn-before-me': {
      // 네 방향을 한 바퀴 돈다. 얼굴 평면과 실루엣이 방향을 따라가는지 본다.
      const puppet = puppetsFor(opposite)[0];
      if (!puppet) return 'NO_PUPPET';
      const distance = options.distance ?? 2;
      const turn = (index: number): Step => ({
        kind: 'send',
        actor: puppet.playerId,
        command: () => ({ type: 'TURN', payload: { direction: 'right' } }),
        label: `turn-${index}`,
      });
      return [
        [
          {
            kind: 'walk',
            actor: puppet.playerId,
            target: operatorCell,
            stopWithin: distance,
            label: 'come-closer',
          },
          { kind: 'face', actor: puppet.playerId, target: operatorCell, label: 'face-operator' },
          turn(1),
          turn(2),
          turn(3),
          turn(4),
        ],
      ];
    }
    case 'trap':
    case 'sensor': {
      const kind = scenario === 'trap' ? ('trap' as const) : ('sensor' as const);
      // S15P21C204-317. 내가 놓은 장비가 실제로 발동하는지는 이 선택지로만 확인할 수 있다.
      // 인형은 내가 무장을 끝낼 때까지 기다렸다가 그 칸으로 들어간다.
      if (options.installer === 'me') {
        if (operator.role !== 'tagger') return 'OPERATOR_MUST_BE_TAGGER';
        if (!world.operator) return 'NO_OPERATOR_STATE';
        const runner = runners[0];
        if (!runner) return 'NO_RUNNER_PUPPET';
        const armed = (now: DemoWorld) =>
          now.operator?.installations.find(
            (device) => device.kind === kind && device.state === 'ARMED',
          ) ?? null;
        return [
          [
            {
              kind: 'until',
              done: (now) => armed(now) !== null,
              failure: 'NO_INSTALL_FROM_OPERATOR',
              label: 'operator-installs',
            },
            {
              kind: 'walk',
              actor: runner.playerId,
              // 무장된 장비 칸으로 들어간다. 매 Tick 다시 읽어 소모된 뒤에도 자리를 잃지 않는다.
              target: (now) => armed(now)?.cell ?? null,
              label: 'runner-enters',
            },
          ],
        ];
      }
      const tagger = taggers[0];
      if (!tagger) return 'NO_TAGGER_PUPPET';
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
      // S15P21C204-317. 누가 다가올지(역할)와 어디서 멈출지(거리)를 고를 수 있다. 술래가
      // 다가오는 것과 도망자가 다가오는 것은 확인하려는 화면이 서로 다르다.
      const puppet = puppetsFor(opposite)[0];
      if (!puppet) return 'NO_PUPPET';
      return [
        [
          {
            kind: 'walk',
            actor: puppet.playerId,
            target: operatorCell,
            stopWithin: options.distance ?? 1,
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
          stopWithin: 1,
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
            stopWithin: 1,
            label: 'first-comes-closer',
          },
          {
            kind: 'walk',
            actor: second.playerId,
            target: firstCell,
            stopWithin: 1,
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
    case 'device-states': {
      // 설치 → 무장 전 → 무장 → 발동 → 소모를 한 줄로 보여 준다. 각 상태 사이에 관찰할
      // 시간을 둔다. `trap` 과 달리 단계별로 멈춰 서서 표시등과 글리프를 보게 하는 것이 목적이다.
      const tagger = taggers[0];
      if (!tagger) return 'NO_TAGGER_PUPPET';
      const runner = runners[0];
      if (!runner) return 'NO_RUNNER_PUPPET';
      const ahead = aheadOf(operator, world.topology);
      const spot = [...(ahead ? [ahead] : []), ...neighbours(world.topology, operator.cell)].find(
        (cell) => isFree(world, cell),
      );
      if (!spot) return 'NO_ROOM_TO_INSTALL';
      const retreat = neighbours(world.topology, spot).find(
        (cell) =>
          !sameCell(cell, operator.cell) && (!occupied(world, cell) || sameCell(cell, tagger.cell)),
      );
      if (!retreat) return 'NO_ROOM_TO_RETREAT';
      return [
        [
          { kind: 'walk', actor: tagger.playerId, target: spot, label: 'walk-to-spot' },
          {
            kind: 'send',
            actor: tagger.playerId,
            command: () => ({ type: 'INSTALL', payload: { kind: 'trap' } }),
            label: 'install',
          },
          // 설치 10 Tick 이 끝나고 무장 20 Tick 이 도는 구간을 따로 보여 준다.
          { kind: 'wait', ticks: 20, label: 'show-unarmed' },
          { kind: 'wait', ticks: ARM_WAIT_TICKS, label: 'show-armed' },
          { kind: 'walk', actor: tagger.playerId, target: retreat, label: 'step-back' },
          { kind: 'walk', actor: runner.playerId, target: spot, label: 'runner-enters' },
          { kind: 'wait', ticks: 40, label: 'show-spent' },
        ],
      ];
    }
    case 'double-trap-immunity': {
      // 첫 덫에 구속되고 둘째 덫은 면역으로 지나간다. 두 칸이 연속이어야 면역 2초가 이동
      // 0.6초를 덮는 것을 볼 수 있다.
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      const tagger = taggers[0];
      if (!tagger) return 'NO_TAGGER_PUPPET';
      const first = relativeCell(world, operator, 'front', 1);
      const second = relativeCell(world, operator, 'front', 2);
      if (!first || !second || !isFree(world, first) || !isFree(world, second))
        return 'NO_ROOM_FOR_TWO_TRAPS';
      const retreat = neighbours(world.topology, second).find(
        (cell) =>
          !sameCell(cell, first) &&
          !sameCell(cell, operator.cell) &&
          (!occupied(world, cell) || sameCell(cell, tagger.cell)),
      );
      if (!retreat) return 'NO_ROOM_TO_RETREAT';
      const install = (spot: Cell, index: number): Step[] => [
        { kind: 'walk', actor: tagger.playerId, target: spot, label: `walk-to-trap-${index}` },
        {
          kind: 'send',
          actor: tagger.playerId,
          command: () => ({ type: 'INSTALL', payload: { kind: 'trap' } }),
          label: `install-trap-${index}`,
        },
        { kind: 'wait', ticks: ARM_WAIT_TICKS, label: `arm-trap-${index}` },
      ];
      return [
        [
          // 먼 칸부터 놓아야 설치자가 앞 칸을 밟고 지나가지 않는다.
          ...install(second, 2),
          ...install(first, 1),
          { kind: 'walk', actor: tagger.playerId, target: retreat, label: 'step-back' },
        ],
      ];
    }
    case 'capture-in-challenge': {
      // 도전 중에도 포획이 성립한다. 인형이 도전을 시작만 하고 버티는 동안 내가 밟는다.
      if (operator.role !== 'tagger') return 'OPERATOR_MUST_BE_TAGGER';
      const runner = runners[0];
      if (!runner) return 'NO_RUNNER_PUPPET';
      const exit = world.exits.find((record) => record.ownerId === runner.playerId);
      if (!exit) return 'NO_EXIT_FOR_PUPPET';
      return [
        [
          { kind: 'walk', actor: runner.playerId, target: exit.approach, label: 'approach-exit' },
          { kind: 'face', actor: runner.playerId, target: exit.wall, label: 'face-exit' },
          {
            kind: 'send',
            actor: runner.playerId,
            command: () => ({ type: 'EXIT_START', payload: { exitId: exit.exitId } }),
            label: 'start-challenge',
          },
          // 완료 보고를 보내지 않고 버틴다. 그동안 관리자가 걸어와 밟으면 규칙이 포획을 낸다.
          {
            kind: 'until',
            done: (now) => subject(now, runner.playerId)?.status !== 'ACTIVE',
            timeout: CHALLENGE_HOLD_TICKS,
            label: 'hold-challenge',
          },
        ],
      ];
    }
    case 'caught-in-my-challenge': {
      // 같은 규칙을 도망자 화면에서 본다. 인형은 내가 도전을 시작할 때까지 옆에서 기다린다.
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      if (!world.operator) return 'NO_OPERATOR_STATE';
      const exit = world.operator.exit;
      if (!exit) return 'NO_OPERATOR_EXIT';
      const tagger = taggers[0];
      if (!tagger) return 'NO_TAGGER_PUPPET';
      return [
        [
          {
            kind: 'walk',
            actor: tagger.playerId,
            target: exit.approach,
            stopWithin: 1,
            label: 'wait-beside-exit',
          },
          {
            kind: 'until',
            done: (now) => now.operator?.challengeId != null,
            failure: 'NO_CHALLENGE_FROM_OPERATOR',
            label: 'operator-starts-challenge',
          },
          { kind: 'walk', actor: tagger.playerId, target: operatorCell, label: 'capture-operator' },
        ],
      ];
    }
    case 'accept-my-exchange': {
      // 요청하는 쪽을 확인한다. 인형은 옆에 와 마주 보고 내 요청이 오면 수락한다.
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      if (!world.operator) return 'NO_OPERATOR_STATE';
      const runner = runners[0];
      if (!runner) return 'NO_RUNNER_PUPPET';
      return [
        [
          {
            kind: 'walk',
            actor: runner.playerId,
            target: operatorCell,
            stopWithin: 1,
            label: 'come-closer',
          },
          { kind: 'face', actor: runner.playerId, target: operatorCell, label: 'face-operator' },
          {
            // 인형 쪽에 세션이 열리면 내 요청이 규칙을 통과한 것이다.
            kind: 'until',
            done: (now) => now.exchanges[runner.playerId] !== undefined,
            failure: 'NO_REQUEST_FROM_OPERATOR',
            label: 'operator-requests',
          },
          {
            kind: 'send',
            actor: runner.playerId,
            command: (now) => {
              const exchangeId = now.exchanges[runner.playerId];
              return exchangeId ? { type: 'EXCHANGE_ACCEPT', payload: { exchangeId } } : null;
            },
            label: 'accept-exchange',
          },
        ],
      ];
    }
    case 'spectate-then-capture': {
      // 포획당해 관전으로 넘어간 뒤 보고 있던 대상이 잡히면 자동으로 다음 대상으로 바뀐다.
      // 트랙 둘이 나란히 돈다: 하나는 나를 잡고, 다른 하나는 내가 관전할 인형을 잡는다.
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      const [firstTagger, secondTagger] = taggers;
      if (!firstTagger || !secondTagger) return 'NEED_TWO_PAIRS';
      const prey = runners[0];
      if (!prey) return 'NEED_TWO_RUNNER_PUPPETS';
      return [
        [
          {
            kind: 'walk',
            actor: firstTagger.playerId,
            target: operatorCell,
            label: 'capture-operator',
          },
          {
            kind: 'until',
            done: (now) => subject(now, world.operatorId)?.status !== 'ACTIVE',
            label: 'operator-captured',
          },
        ],
        [
          // 내가 잡히기 전에 움직이면 관전 대상이 먼저 사라진다. 순서를 지킨다.
          {
            kind: 'until',
            done: (now) => subject(now, world.operatorId)?.status !== 'ACTIVE',
            label: 'wait-for-spectating',
          },
          {
            kind: 'walk',
            actor: secondTagger.playerId,
            target: (now) => subject(now, prey.playerId)?.cell ?? null,
            label: 'capture-watched',
          },
          {
            kind: 'until',
            done: (now) => subject(now, prey.playerId)?.status !== 'ACTIVE',
            label: 'watched-captured',
          },
        ],
      ];
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
): Step[][] | DemoRejection {
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
