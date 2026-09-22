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
  'NO_EXCHANGE_PARTNER',
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
  'CANCELED',
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
  /**
   * 두 참가자에게 아직 나눌 지식이 남았는지(KN-06). 규칙은 나눌 것이 없는 짝의 교환 요청을
   * 거절하므로, 교환 대본은 이것으로 상대를 고른다. 방이 채우지 않으면 아무나 고른다.
   */
  exchangeGain?: (from: string, to: string) => boolean;
  /** S15P21C204-317. 관리자 주도 대본이 읽는다. 방이 채우기 전에는 없다. */
  operator?: DemoOperatorState;
}>;

export type PuppetCommand =
  | Readonly<{ type: 'MOVE_INTENT'; payload: { direction: 'forward' | 'back' | null } }>
  | Readonly<{ type: 'TURN'; payload: { direction: 'left' | 'right' } }>
  | Readonly<{ type: 'GRAB_INTENT'; payload: Record<string, never> }>
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
  /** S15P21C204-342. 마지막으로 끝까지 간 대본. 실패로 끝났으면 null 이다. */
  completed: DemoScenario | null;
  /** 대본이 끝날 때마다 오르는 번호. 화면이 같은 결과가 다시 났음을 알 수 있다. */
  outcomes: number;
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
/**
 * S15P21C204-317. 인형이 도전을 붙들고 있는 시간.
 *
 * 332: 20초(400 Tick)는 인형이 미로 반대편 자기 출구에서 버티는 동안 관리자가 그 자리를 찾아
 * 걸어갈 수 있는 시간이 아니었다. 이제 대본이 관리자를 그 옆에 세우므로 잡기를 누를 시간만
 * 있으면 되지만, 화면을 둘러보고 누를 여유로 60초를 둔다.
 */
const CHALLENGE_HOLD_TICKS = 1200;
/** S15P21C204-342. 내 도전 화면을 한 번 보고 나서 잡히도록, 술래 인형이 한 박자 쉰다. */
const SHOW_CHALLENGE_TICKS = 40;
/** Long enough for the operator to see an incoming offer before the puppet withdraws it. */
const CANCEL_AFTER_TICKS = 20;
/**
 * A grab window lasts `grabTicks + 1` (7) ticks. A puppet re-arms only after it has closed, so a
 * prey that stepped away is grabbed again once the tagger is back in front of it.
 */
const GRAB_RETRY_TICKS = 8;
/**
 * S15P21C204-316. A placement lands on the next tick. The core refuses one silently (a busy
 * participant, an occupied or start cell), so a placement not read back by then was refused, and
 * the step says so instead of asking again until the two-minute budget runs out.
 */
const PLACE_CONFIRM_TICKS = 10;

type Target = Cell | ((world: DemoWorld) => Cell | null);

type Step =
  /** `stopWithin` cells from the target is close enough; 0 means the target cell itself. */
  | { kind: 'walk'; actor: string; target: Target; stopWithin?: number; label: string }
  | { kind: 'face'; actor: string; target: Target; label: string }
  /**
   * S15P21C204-317. Catches `prey` by the grab rule (319): the tagger comes to a cell beside it,
   * faces it and arms its grab, following the prey if it moves. Since 319 stepping onto a runner
   * without an armed grab is not a capture, so a plain `walk` onto the prey never ends.
   */
  | { kind: 'grab'; actor: string; prey: string; label: string }
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
  /** S15P21C204-342. 도는 대본을 관리자가 내린다. 라운드는 그대로 둔다. */
  cancel(): void;
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

/**
 * S15P21C204-342. 모든 대본과, 지금 시작할 수 없다면 그 이유. 기본 선택지로 판단한다.
 * 목록에서 빼 버리면 버튼이 조용히 사라져 관리자가 무엇이 없어졌는지 알 수 없다.
 */
export function scenarioOffers(
  world: DemoWorld,
): readonly { id: DemoScenario; unavailable?: DemoRejection }[] {
  return DEMO_SCENARIOS.map((scenario) => {
    const built = build(scenario, world, {});
    return typeof built === 'string' ? { id: scenario, unavailable: built } : { id: scenario };
  });
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
  /** The tick each puppet tagger last armed its grab. */
  const grabbedAt = new Map<string, number>();
  let completed: DemoScenario | null = null;
  let outcomes = 0;

  /** 대본이 끝났다. 성공이든 실패든 결과 번호를 올려 화면이 그 사실을 알 수 있게 한다. */
  const finish = (reason: string | null) => {
    if (scenario) {
      outcomes += 1;
      completed = reason ? null : scenario;
    }
    if (reason) failure = reason;
    reset();
  };

  /** 대본만 내린다. 라운드가 끝나 더 볼 것이 없을 때 쓰며, 결과로 치지 않는다. */
  const reset = () => {
    scenario = null;
    tracks = [];
    releasing.clear();
    grabbedAt.clear();
  };
  return {
    start(next, world, options = {}) {
      // S15P21C204-313. A refusal is reported like a stop, `<scenario>:<reason>`. The room used to
      // drop the return value, so a button refused by its options answered with nothing at all.
      // A scenario already running keeps running.
      const refused = checkOptions(next, options) ?? build(next, world, options);
      if (typeof refused === 'string') {
        failure = `${next}:${refused}`;
        return refused;
      }
      const built = refused;
      scenario = next;
      tracks = built.map((steps) => ({ steps, index: 0, enteredAt: world.tick }));
      failure = null;
      completed = null;
      releasing.clear();
      grabbedAt.clear();
      return null;
    },
    stop: () => reset(),
    cancel: () => finish(scenario ? `${scenario}:CANCELED` : null),
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
        const outcome = run(step, world, io, elapsed, releasing, grabbedAt);
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
      return { scenario, step: running[0] ?? null, failure, completed, outcomes };
    },
  };
}

function run(
  step: Step,
  world: DemoWorld,
  { send, drop, place }: DemoIo,
  elapsed: number,
  releasing: Set<string>,
  grabbedAt: Map<string, number>,
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
    if (elapsed > PLACE_CONFIRM_TICKS) return 'failed';
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
  if (step.kind === 'grab') {
    const prey = subject(world, step.prey);
    if (!prey) return 'failed';
    if (prey.status !== 'ACTIVE') return 'done';
    if (actor.action) return 'running';
    return grab(actor, prey, world, send, releasing, grabbedAt, place);
  }
  // A puppet in the middle of a move, turn or installation is left to finish it.
  if (actor.action) return 'running';
  const target = typeof step.target === 'function' ? step.target(world) : step.target;
  if (!target) return 'failed';
  if (step.kind === 'face') return turnToward(actor, target, send) ?? 'done';
  return walk(actor, target, step.stopWithin ?? 0, world, send, releasing, place);
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
  place?: DemoIo['place'],
): 'done' | 'running' | 'failed' {
  if (sameCell(actor.cell, target)) return 'done';
  const next = pathStep(world, actor, target, stopWithin);
  if (next === 'arrived') return 'done';
  if (!next) return placeInstead(actor, target, stopWithin, world, place);
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
 * S15P21C204-321. On the size-scaled mazes the corridors are one cell wide and the puppets stand
 * still outside their scripts, so their bodies can leave no route at all. A demo shows what the
 * rules do at the destination, not the walk, so a walk with no route jumps there instead. The
 * core still refuses an occupied cell, and the walk keeps asking until the move is read back.
 */
function placeInstead(
  actor: GameSubject,
  target: Cell,
  stopWithin: number,
  world: DemoWorld,
  place: DemoIo['place'] | undefined,
): 'running' | 'failed' {
  if (!place) return 'failed';
  // S15P21C204-342. 목적지에서 stopWithin 칸 안의 빈 칸이어야 한다. 그냥 "가장 가까운 빈 칸"으로
  // 옮기면 조건을 못 채운 자리에 내려놓고, 다음 Tick 에 또 같은 자리로 옮기며 상한까지 맴돈다.
  const spot = freeSpotNear(world, target, stopWithin);
  if (!spot) return 'failed';
  return place(actor.playerId, spot, actor.dir) ? 'running' : 'failed';
}

/**
 * One tick of a `grab` step. The rules capture a runner that is one walkable cell in front of a
 * tagger whose grab window is open, so the tagger stops beside the prey instead of on it, faces
 * it and arms. The grab window (7 ticks) is shorter than a move (12), so arming first and then
 * walking in closes the window before the tagger arrives.
 */
function grab(
  actor: GameSubject,
  prey: GameSubject,
  world: DemoWorld,
  send: (actor: string, command: PuppetCommand) => boolean,
  releasing: Set<string>,
  grabbedAt: Map<string, number>,
  place?: DemoIo['place'],
): 'running' | 'failed' {
  if (!sameCell(actor.cell, prey.cell)) {
    const moved = walk(actor, prey.cell, 1, world, send, releasing, place);
    if (moved !== 'done') return moved;
    const turn = turnToward(actor, prey.cell, send);
    if (turn) return turn;
  }
  const last = grabbedAt.get(actor.playerId);
  if (last !== undefined && world.tick - last < GRAB_RETRY_TICKS) return 'running';
  if (!send(actor.playerId, { type: 'GRAB_INTENT', payload: {} })) return 'failed';
  grabbedAt.set(actor.playerId, world.tick);
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
/** The closest free cell by walking distance from `from`, excluding `from` itself. */
function nearestFreeCell(world: DemoWorld, from: Cell): Cell | null {
  const seen = new Set<string>([key(from)]);
  const queue: Cell[] = [from];
  for (let index = 0; index < queue.length; index++) {
    for (const next of neighbours(world.topology, queue[index]!)) {
      if (seen.has(key(next))) continue;
      seen.add(key(next));
      if (isFree(world, next)) return next;
      queue.push(next);
    }
  }
  return null;
}

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
      // S15P21C204-321. 작은 미로에서는 출구 앞 칸이 누군가의 시작 칸인 배치가 13% 나오고,
      // 인형은 대본 밖에서 움직이지 않으므로 그 자리에 그대로 서 있다. 먼저 비키게 한다.
      const blocker = world.participants.find(
        (player) =>
          player.playerId !== world.operatorId &&
          player.status === 'ACTIVE' &&
          sameCell(player.cell, exit.approach),
      );
      const clearing: Step[] = [];
      if (blocker) {
        if (!world.puppetIds.includes(blocker.playerId)) return 'CELL_UNAVAILABLE';
        const spot = nearestFreeCell(world, exit.approach);
        if (!spot) return 'CELL_UNAVAILABLE';
        clearing.push({
          kind: 'place',
          actor: blocker.playerId,
          target: spot,
          dir: () => blocker.dir,
          label: 'clear-exit',
        });
      }
      return [
        [
          ...clearing,
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
        // S15P21C204-342. 무장된 장비의 자리를 한 번 보면 기억한다. 발동한 장비는 더 이상 무장
        // 상태가 아니어서, 자리를 매 Tick 다시 읽던 단계는 도망자가 밟는 순간 목표를 잃고
        // "규칙이 이 동작을 받아들이지 않았습니다" 로 멈췄다. 대본이 보여 주려던 바로 그 순간이다.
        let installed: Cell | null = null;
        const armed = (now: DemoWorld) => {
          const device =
            now.operator?.installations.find(
              (candidate) => candidate.kind === kind && candidate.state === 'ARMED',
            ) ?? null;
          if (device) installed = device.cell;
          return device;
        };
        const installedCell = (now: DemoWorld) => armed(now)?.cell ?? installed;
        // S15P21C204-342. 규칙은 시작 칸에 장비를 놓지 못하게 한다(EQ-01). 관리자는 경기 시작 위치,
        // 곧 자기 시작 칸에 서 있으므로 이 대본은 관리자가 스스로 한 칸 걸어 나오기 전에는 절대
        // 성립하지 않았고, 화면에는 그 이유가 없었다. 설치할 수 있는 자리로 먼저 옮긴다.
        const install = installableSpot(world, operator, kind);
        const onInstallableCell = !world.startCells.some((cell) => sameCell(cell, operator.cell));
        if (install === null && !onInstallableCell)
          return kind === 'trap' ? 'NO_ROOM_TO_INSTALL' : 'NO_WALL_TO_MOUNT';
        const settle: Step[] =
          install === null
            ? []
            : [
                {
                  kind: 'place',
                  actor: world.operatorId,
                  target: install.cell,
                  dir: () => install.dir,
                  label: 'stand-where-i-can-install',
                },
              ];
        return [
          [
            ...settle,
            {
              kind: 'until',
              done: (now) => armed(now) !== null,
              failure: 'NO_INSTALL_FROM_OPERATOR',
              label: 'operator-installs',
            },
            // S15P21C204-342. 장비는 내가 선 칸에 놓인다. 그 위에 그대로 서 있으면 도망자가
            // 들어올 수 없다(칸 위의 술래는 포획 판정이지 발동이 아니다). 인형 설치자가 물러나듯
            // 관리자도 옆으로 비킨다.
            {
              kind: 'place',
              actor: world.operatorId,
              target: (now) => {
                const device = installedCell(now);
                return device ? besideCell(now, device, world.operatorId) : null;
              },
              dir: (now) => subject(now, world.operatorId)?.dir ?? null,
              label: 'step-aside-for-runner',
            },
            {
              kind: 'walk',
              actor: runner.playerId,
              // 장비가 놓인 칸으로 들어간다. 발동해 무장이 풀려도 기억한 자리를 그대로 쓴다.
              target: (now) => installedCell(now),
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
          {
            kind: 'grab',
            actor: tagger.playerId,
            prey: world.operatorId,
            label: 'chase-operator',
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
      if (!runners[0]) return 'NO_RUNNER_PUPPET';
      // 한 번 교환한 짝은 나눌 지식이 없어 규칙이 다음 요청을 거절한다. 남은 상대를 고른다.
      const runner = exchangePartner(world, runners, world.operatorId);
      if (!runner) return 'NO_EXCHANGE_PARTNER';
      const steps: Step[] = [
        ...clearSpaceBeside(world, runner.playerId),
        ...awaitNoSession(runner.playerId),
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
      if (runners.length < 2) return 'NEED_TWO_RUNNER_PUPPETS';
      // 흔적을 보려면 두 인형이 실제로 교환해야 한다. 나눌 지식이 남은 짝을 고른다.
      const pair = exchangePair(world, runners);
      if (!pair) return 'NO_EXCHANGE_PARTNER';
      const [first, second] = pair;
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
          ...awaitNoSession(first.playerId),
          ...awaitNoSession(second.playerId),
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
          // S15P21C204-342. 인형의 출구는 미로 반대편일 수 있다. 관리자가 찾아 걸어갈 방법이
          // 없어 매번 시간 초과로 끝났으므로, 도전이 열린 뒤 관리자를 그 옆에 세워 마주 보게 한다.
          {
            kind: 'place',
            actor: world.operatorId,
            target: (now) =>
              besideCell(now, subject(now, runner.playerId)?.cell ?? null, world.operatorId),
            // 방향은 "옮겨 갈 칸에서" 인형을 보는 방향이다. 지금 선 자리 기준으로 세면 배치가
            // 끝나도 방향이 맞지 않아 확정되지 않는다(S15P21C204-342).
            dir: (now) => {
              const prey = subject(now, runner.playerId);
              const spot = prey ? besideCell(now, prey.cell, world.operatorId) : null;
              return prey && spot ? facingDirection(spot, prey.cell) : null;
            },
            label: 'stand-beside-challenge',
          },
          // 완료 보고를 보내지 않고 버틴다. 그동안 관리자가 잡으면 규칙이 포획을 낸다.
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
          // S15P21C204-342. 곧바로 잡으면 도전 화면을 한 번도 못 본다. 한 박자 보여 준 뒤 잡는다.
          { kind: 'wait', ticks: SHOW_CHALLENGE_TICKS, label: 'show-my-challenge' },
          {
            kind: 'grab',
            actor: tagger.playerId,
            prey: world.operatorId,
            label: 'capture-operator',
          },
        ],
      ];
    }
    case 'accept-my-exchange': {
      // 요청하는 쪽을 확인한다. 인형은 옆에 와 마주 보고 내 요청이 오면 수락한다.
      if (operator.role !== 'runner') return 'OPERATOR_MUST_BE_RUNNER';
      if (!world.operator) return 'NO_OPERATOR_STATE';
      if (!runners[0]) return 'NO_RUNNER_PUPPET';
      const runner = exchangePartner(world, runners, world.operatorId);
      if (!runner) return 'NO_EXCHANGE_PARTNER';
      return [
        [
          ...clearSpaceBeside(world, runner.playerId),
          ...awaitNoSession(runner.playerId),
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
            kind: 'grab',
            actor: firstTagger.playerId,
            prey: world.operatorId,
            label: 'capture-operator',
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
            kind: 'grab',
            actor: secondTagger.playerId,
            prey: prey.playerId,
            label: 'capture-watched',
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

/** Each puppet tagger catches its own puppet runner by the grab rule. */
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
      kind: 'grab' as const,
      actor: tagger.playerId,
      prey: prey.playerId,
      label: `capture-${prey.playerId}`,
    },
  ]);
}

/**
 * `target` 에서 걸어서 `stopWithin` 칸 안에 있는 빈 칸. 거리는 몸을 지나쳐 세고, 내려놓을 칸은
 * 비어 있어야 한다. 조건을 채우는 칸이 없으면 null 이고, 그 단계는 곧바로 실패로 끝난다.
 */
function freeSpotNear(world: DemoWorld, target: Cell, stopWithin: number): Cell | null {
  if (stopWithin === 0) return isFree(world, target) ? target : null;
  const seen = new Set<string>([key(target)]);
  let frontier: Cell[] = [target];
  for (let step = 1; step <= stopWithin; step += 1) {
    const next: Cell[] = [];
    for (const cell of frontier)
      for (const neighbour of neighbours(world.topology, cell)) {
        if (seen.has(key(neighbour))) continue;
        seen.add(key(neighbour));
        if (isFree(world, neighbour)) return neighbour;
        next.push(neighbour);
      }
    frontier = next;
  }
  return null;
}

/**
 * 그 칸 옆의 빈 칸. 없으면 가장 가까운 빈 칸으로 물러난다.
 *
 * S15P21C204-342. `mover` 는 지금 그리로 옮겨 갈 참가자다. 옮기고 나면 그 칸은 "누가 서 있는
 * 칸" 이 되므로, 자신을 빼고 보지 않으면 다음 Tick 에 다른 칸을 골라 배치가 끝나지 않는다.
 */
function besideCell(world: DemoWorld, cell: Cell | null, mover?: string): Cell | null {
  if (!cell) return null;
  const free = (next: Cell) =>
    !world.startCells.some((start) => sameCell(start, next)) &&
    !world.participants.some(
      (player) =>
        player.status === 'ACTIVE' && player.playerId !== mover && sameCell(player.cell, next),
    );
  return neighbours(world.topology, cell).find(free) ?? nearestFreeCell(world, cell);
}

/**
 * S15P21C204-342. 관리자가 장비를 놓을 수 있는 자리. 시작 칸이 아니고 아무도 서 있지 않은
 * 이웃 칸이며, 감지기는 벽을 마주 봐야 붙일 수 있으므로 벽 낀 칸을 고르고 그 벽을 보게 한다.
 * 지금 선 자리가 이미 조건을 만족하면 null 을 돌려 옮기지 않는다.
 */
function installableSpot(
  world: DemoWorld,
  operator: GameSubject,
  kind: 'sensor' | 'trap',
): { cell: Cell; dir: Dir } | null {
  // 내가 선 칸은 나 때문에 "누가 서 있는 칸" 이 된다. 나를 빼고 본다.
  const free = (cell: Cell) =>
    !world.startCells.some((startCell) => sameCell(startCell, cell)) &&
    !world.participants.some(
      (player) =>
        player.status === 'ACTIVE' &&
        player.playerId !== operator.playerId &&
        sameCell(player.cell, cell),
    );
  const usable = (cell: Cell) =>
    free(cell) && (kind === 'trap' || wallBeside(world, cell) !== null);
  const facing = (cell: Cell): Dir | null => {
    if (kind === 'trap') return operator.dir;
    const wall = wallBeside(world, cell);
    return wall ? facingDirection(cell, wall) : null;
  };
  if (usable(operator.cell)) {
    // 덫은 선 자리에 그대로 놓는다. 감지기는 벽을 봐야 붙으므로 방향만 맞춘다.
    const dir = facing(operator.cell);
    if (kind === 'trap' || dir === operator.dir || dir === null) return null;
    return { cell: operator.cell, dir };
  }
  for (const cell of neighbours(world.topology, operator.cell)) {
    if (!usable(cell)) continue;
    const dir = facing(cell);
    if (dir !== null) return { cell, dir };
  }
  return null;
}

/**
 * S15P21C204-342. 관리자 옆에 빈 칸이 없으면 교환하러 오는 인형이 설 자리가 없다. 먼저 교환한
 * 인형이 그 자리를 차지한 채로 다음 대본을 누르면 이 일이 생긴다. 서 있는 인형 하나를 비킨다.
 */
function clearSpaceBeside(world: DemoWorld, keep: string): Step[] {
  if (
    neighbours(world.topology, subject(world, world.operatorId)?.cell ?? { x: -1, y: -1 }).some(
      (cell) => isFree(world, cell),
    )
  )
    return [];
  const operator = subject(world, world.operatorId);
  if (!operator) return [];
  const blocker = neighbours(world.topology, operator.cell)
    .map((cell) =>
      world.participants.find(
        (player) =>
          player.status === 'ACTIVE' &&
          player.playerId !== keep &&
          world.puppetIds.includes(player.playerId) &&
          sameCell(player.cell, cell),
      ),
    )
    .find((player) => player !== undefined);
  if (!blocker) return [];
  const spot = nearestFreeCell(world, blocker.cell);
  if (!spot) return [];
  return [
    {
      kind: 'place',
      actor: blocker.playerId,
      target: spot,
      dir: () => blocker.dir,
      label: 'make-room-beside-me',
    },
  ];
}

/**
 * 아직 나눌 지식이 남은 상대. 방이 규칙을 알려 주지 않으면(합성 세계 시험) 첫 인형을 쓴다.
 * 판정은 규칙이 하고, 대본은 규칙이 받아 줄 상대를 고르기만 한다(S15P21C204-342).
 */
function exchangePartner(
  world: DemoWorld,
  pool: readonly GameSubject[],
  other: string,
): GameSubject | null {
  const gain = world.exchangeGain;
  if (!gain) return pool[0] ?? null;
  return pool.find((puppet) => gain(other, puppet.playerId)) ?? null;
}

/** 서로 나눌 지식이 남은 인형 둘. 흔적 대본은 인형끼리 교환시킨다. */
function exchangePair(
  world: DemoWorld,
  pool: readonly GameSubject[],
): readonly [GameSubject, GameSubject] | null {
  const gain = world.exchangeGain;
  if (!gain) return pool[0] && pool[1] ? [pool[0], pool[1]] : null;
  for (const first of pool)
    for (const second of pool)
      if (first.playerId !== second.playerId && gain(first.playerId, second.playerId))
        return [first, second];
  return null;
}

/**
 * S15P21C204-342. 앞 대본이 남긴 교환 요청이 사라질 때까지 기다린다.
 *
 * 교환 요청은 2초를 살고 저절로 사라진다. 그 사이에 다음 교환 대본을 누르면, 새 요청을 기다리던
 * 단계가 **남아 있던 요청**을 보고 지나가 버린다. 그 뒤 취소할 때는 이미 사라져 "규칙이 이 동작을
 * 받아들이지 않았습니다" 로 끝났다. 규칙도 세션이 열려 있는 동안에는 새 요청을 받지 않는다.
 */
function awaitNoSession(playerId: string): Step[] {
  return [
    {
      kind: 'until',
      done: (now) => now.exchanges[playerId] === undefined,
      timeout: EXCHANGE_OFFER_TICKS + POSE_HOLD_TICKS,
      label: 'wait-offer-clear',
    },
  ];
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
