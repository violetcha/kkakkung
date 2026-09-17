import type {
  ActiveSelf,
  Cell,
  Dir,
  KnownTerrain,
  PrivateView,
  Role,
  WallFace,
} from '@kkakkung/protocol/game-schema';
import type { CommandInput } from '../../input/InteractionRuntime';
import { PRODUCT_TICK_MS } from '@kkakkung/protocol/game-schema';
import { SERVER_ACTION_MS } from '../../input/input-tuning';
import { advanceKey, challengeKeys, type ChallengeKey } from '../pose/key-challenge';

export const LESSONS = {
  forward: '한 칸 전진',
  back: '한 칸 후진',
  left: '왼쪽 90° 회전',
  right: '오른쪽 90° 회전',
  neutral: '중립으로 멈추기',
  runner: '도망자 · 탈출 도전',
  tagger: '술래 · 장비 설치',
} as const;
export type Lesson = keyof typeof LESSONS;
const STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
// Public, purpose-built 3 × 5 classroom. No production map, seed or game-core imports.
const floors: Cell[] = [];
for (let y = 1; y <= 5; y++) for (let x = 1; x <= 3; x++) floors.push({ x, y });
const walls: WallFace[] = floors.flatMap((cell) =>
  STEPS.flatMap(([dx, dy], dir) => {
    const next = { x: cell.x + dx, y: cell.y + dy };
    return floors.some((floor) => same(floor, next))
      ? []
      : [{ ...next, side: ((dir + 2) % 4) as Dir }];
  }),
);
const terrain: KnownTerrain[] = [
  ...floors.map((cell) => ({ ...cell, kind: 'floor' as const })),
  ...walls.map((wall) => ({ ...wall, kind: 'wall' as const })),
];

export function createSoloWorld(now: () => number) {
  let self: ActiveSelf = {
    playerId: 'solo-self',
    role: 'runner',
    status: 'ACTIVE',
    cell: { x: 2, y: 3 },
    dir: 0,
    action: null,
    equipment: { sensor: 1, trap: 1 },
    ownedEquipment: [],
    restraintUntilTick: null,
    restraintImmuneUntilTick: null,
    installation: null,
    exchange: null,
    challenge: null,
    loading: null,
  };
  const completed = new Set<Lesson>();
  let sequence = 0;
  let pendingLesson: Lesson | null = null;
  let move: 'forward' | 'back' | null = null;
  let refreshedAt = 0;
  let queuedTurn: 'left' | 'right' | null = null;
  let neutralAt: number | null = null;
  let keyIndex = 0;
  let poseProgress = 0;
  let enabled = true;
  let message = 'W/S로 앞뒤 이동, A/D로 90° 회전을 해 보세요.';
  const tick = () => now() / PRODUCT_TICK_MS;
  const exit = {
    exitId: 'solo-exit',
    ownerId: self.playerId,
    approach: { x: 2, y: 1 },
    wall: { x: 2, y: 0, side: 2 as const },
  };
  const atExit = () => self.role === 'runner' && same(self.cell, exit.approach) && self.dir === 0;
  const frontWall = () => {
    const [dx, dy] = STEPS[self.dir];
    return walls.find(
      (wall) =>
        wall.x === self.cell.x + dx &&
        wall.y === self.cell.y + dy &&
        wall.side === (self.dir + 2) % 4,
    );
  };
  const clearIntent = () => {
    move = null;
    queuedTurn = null;
    neutralAt = null;
  };
  const finishRunner = () => {
    completed.add('runner');
    self = { ...self, challenge: null };
    poseProgress = 1;
    message = '탈출 도전 성공! 실제 경기에서는 내 출구를 찾고 도전 중 포획도 피해야 합니다.';
  };
  const startAction = (kind: 'move' | 'turn', direction: 'forward' | 'back' | 'left' | 'right') => {
    if (self.action || self.installation || self.challenge) return;
    const from = { ...self.cell, dir: self.dir };
    let to = { ...from };
    if (kind === 'turn') to.dir = ((self.dir + (direction === 'left' ? 3 : 1)) % 4) as Dir;
    else {
      const [dx, dy] = STEPS[self.dir];
      const sign = direction === 'forward' ? 1 : -1;
      to = { ...to, x: to.x + dx * sign, y: to.y + dy * sign };
      if (!floors.some((cell) => same(cell, to))) {
        message = '벽입니다. A/D로 돌아서거나 S로 한 칸 물러나세요.';
        return;
      }
    }
    pendingLesson = direction;
    self = {
      ...self,
      cell: { x: to.x, y: to.y },
      dir: to.dir,
      action: {
        kind,
        from,
        to,
        startTick: tick(),
        endTick: tick() + SERVER_ACTION_MS[kind] / PRODUCT_TICK_MS,
      },
    };
  };
  const poll = () => {
    if (!enabled) return;
    if (self.action && tick() >= self.action.endTick) {
      if (neutralAt !== null)
        neutralAt = Math.max(neutralAt, self.action.endTick * PRODUCT_TICK_MS);
      if (pendingLesson) completed.add(pendingLesson);
      self = { ...self, action: null };
      pendingLesson = null;
    }
    if (self.installation && tick() >= self.installation.endTick) {
      const kind = self.installation.kind;
      const equipmentId = self.installation.installationId;
      const wall = frontWall();
      self = {
        ...self,
        installation: null,
        equipment: { ...self.equipment, [kind]: self.equipment[kind] - 1 },
        ownedEquipment: [
          ...self.ownedEquipment,
          kind === 'sensor' && wall
            ? {
                equipmentId,
                kind: 'sensor',
                cell: self.cell,
                wall,
                state: 'ARMED',
                armedTick: tick(),
              }
            : { equipmentId, kind: 'trap', cell: self.cell, state: 'ARMED', armedTick: tick() },
        ],
      };
      completed.add('tagger');
      message = '설치 성공! 감지기는 앞쪽 벽, 덫은 현재 바닥에 놓입니다.';
    }
    if (self.challenge && tick() >= self.challenge.expiresAtTick) {
      self = { ...self, challenge: null };
      keyIndex = 0;
      poseProgress = 0;
      message = '도전 시간이 끝났습니다. E로 다시 시작하세요.';
    }
    if (self.challenge && keyIndex === 4 && tick() >= self.challenge.minSuccessTick) finishRunner();
    if (move && now() - refreshedAt > 350) {
      move = null;
      neutralAt = null;
    }
    if (!self.action && !self.installation && !self.challenge) {
      if (
        neutralAt !== null &&
        !move &&
        now() - neutralAt >= 500 &&
        (completed.has('forward') || completed.has('back'))
      ) {
        completed.add('neutral');
        neutralAt = null;
      }
      if (queuedTurn) {
        const direction = queuedTurn;
        queuedTurn = null;
        startAction('turn', direction);
      } else if (move) startAction('move', move);
    }
  };
  return {
    poll,
    dispatch(command: CommandInput, validRelease = false) {
      if (!enabled) return;
      // Do not start a second held action before consuming a release at its boundary.
      if (command.type === 'MOVE_INTENT') {
        const previous = move;
        move = command.payload.direction;
        refreshedAt = now();
        if (move === null && previous !== null && validRelease) neutralAt = now();
        else if (move !== null) neutralAt = null;
        poll();
        return;
      }
      poll();
      if (
        command.type === 'EXIT_CANCEL' &&
        self.challenge?.challengeId === command.payload.challengeId
      ) {
        self = { ...self, challenge: null };
        keyIndex = 0;
        poseProgress = 0;
        return;
      }
      if (
        command.type === 'INSTALL_CANCEL' &&
        self.installation?.installationId === command.payload.installationId
      ) {
        self = { ...self, installation: null };
        return;
      }
      if (self.challenge || self.installation) return;
      if (command.type === 'TURN') {
        if (self.action) queuedTurn = command.payload.direction;
        else startAction('turn', command.payload.direction);
      } else if (
        command.type === 'EXIT_START' &&
        command.payload.exitId === exit.exitId &&
        atExit() &&
        !self.action
      ) {
        clearIntent();
        keyIndex = 0;
        poseProgress = 0;
        self = {
          ...self,
          challenge: {
            challengeId: 'solo-challenge-' + ++sequence,
            exitId: exit.exitId,
            poseKind: 'y',
            startedAtTick: tick(),
            minSuccessTick: tick() + 24,
            expiresAtTick: tick() + 200,
          },
        };
        message = '양팔 Y자를 1.2초 유지하거나 키보드 모드에서 방향키 순서를 완성하세요.';
      } else if (command.type === 'INSTALL' && self.role === 'tagger' && !self.action) {
        const kind = command.payload.kind;
        if (!self.equipment[kind]) {
          message = '체험용 장비를 사용했습니다. 술래 체험으로 다시 시작하세요.';
          return;
        }
        if (kind === 'sensor' && !frontWall()) {
          message = '감지기를 설치하려면 바로 앞의 벽을 바라보세요.';
          return;
        }
        clearIntent();
        self = {
          ...self,
          installation: {
            installationId: 'solo-install-' + ++sequence,
            kind,
            startTick: tick(),
            endTick: tick() + 10,
            armedTick: tick() + 10,
          },
        };
        message = '설치 중입니다. F로 취소할 수 있습니다.';
      }
    },
    key(key: ChallengeKey, repeat = false) {
      if (!enabled || !self.challenge || tick() >= self.challenge.expiresAtTick) return;
      keyIndex = advanceKey(challengeKeys(self.challenge.challengeId), keyIndex, key, repeat);
      poll();
    },
    pose(heldMs: number) {
      if (!enabled || !self.challenge || tick() >= self.challenge.expiresAtTick) return;
      poseProgress = Math.min(1, Math.max(0, heldMs / 1200));
      if (poseProgress === 1 && tick() >= self.challenge.minSuccessTick) finishRunner();
    },
    clearChallengeProgress() {
      keyIndex = 0;
      poseProgress = 0;
    },
    clearInput: clearIntent,
    cancelNeutral() {
      neutralAt = null;
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) {
        clearIntent();
        pendingLesson = null;
        const from = self.action?.from;
        self = {
          ...self,
          ...(from ? { cell: { x: from.x, y: from.y }, dir: from.dir } : {}),
          action: null,
          installation: null,
          challenge: null,
        };
        keyIndex = 0;
        poseProgress = 0;
      }
    },
    lesson(role: Role) {
      clearIntent();
      pendingLesson = null;
      keyIndex = 0;
      poseProgress = 0;
      self = {
        ...self,
        role,
        cell: role === 'runner' ? { x: 2, y: 1 } : { x: 1, y: 3 },
        dir: role === 'runner' ? 0 : 3,
        action: null,
        challenge: null,
        installation: null,
        ownedEquipment: [],
        equipment: { sensor: 1, trap: 1 },
      };
      message =
        role === 'runner'
          ? '내 출구 앞입니다. E로 탈출 도전을 시작하세요.'
          : '설치 연습 위치입니다. 1: 감지기 / 2: 덫을 선택하고 F 또는 V 손동작으로 설치하세요.';
    },
    get snapshot() {
      const view: PrivateView = {
        matchId: 'solo-local',
        stateVersion: ++sequence,
        mapVersion: 1,
        gameScope: { gameInstanceId: 'solo-classroom', kind: 'practice', revision: 1 },
        self,
        knownTerrain: terrain,
        knownActiveExits: self.role === 'runner' ? [exit] : [],
        visibleCells: floors,
        visibleWallFaces: walls,
        visibleEntities: self.ownedEquipment.map((item) => ({
          ...item,
          id: item.equipmentId,
          state: 'ARMED' as const,
        })),
      };
      return {
        view,
        self,
        tick: tick(),
        completed: [...completed],
        message,
        keyIndex,
        poseProgress,
        exitId: atExit() && !self.action ? exit.exitId : undefined,
      };
    },
  };
}
