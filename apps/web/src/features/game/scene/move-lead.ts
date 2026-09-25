import {
  PRODUCT_ACTION_MS,
  type Action,
  type Cell,
  type Dir,
  type PrivateView,
} from '@kkakkung/protocol/game-schema';

/**
 * S15P21C204-389. 멈춰 있다가 보낸 한 칸 이동을 1인칭 카메라가 먼저 시작한다. 회전(turn-lead)과
 * 같은 방식이다. 서버 이동이 오면 둘 중 더 나아간 쪽을 그리고, 끝나면 서버 값만 쓴다.
 *
 * 서버가 이동을 거절하는 경우는 구속·탈출 도전·앞 칸이 통로가 아님 셋뿐이다(engine
 * handleMoveIntent, movement.moveTarget). 그래서 앞 칸이 내가 아는 통로이고 구속·도전 중이 아닐
 * 때만 예측한다. 하나라도 모르면 예측하지 않고 지금처럼 서버를 기다린다.
 * `ageMs`는 보낸 뒤 흐른 시간이다. 읽는 쪽이 자기 시계로 계산해 넘긴다.
 */
export type MoveLead = Readonly<{ from: Cell; to: Cell; dir: Dir; ageMs: number }>;

/** 서버 이동 시작을 기다리는 최대 시간. 이 안에 오지 않으면 예측을 버린다. */
export const MOVE_LEAD_GRACE_MS = 600;

/** 방향별 앞칸 벡터. 원본은 game-core 의 DIR_VECTORS 다. */
const AHEAD = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
] as const;

/** 예측해도 되는 이동의 목적지. 확실하지 않으면 null. */
export function moveLeadTarget(
  view: PrivateView | null,
  direction: 'forward' | 'back' | null,
): Cell | null {
  const self = view?.self;
  if (!view || !direction || self?.status !== 'ACTIVE') return null;
  if (self.action || self.challenge || self.restraintUntilTick !== null) return null;
  const v = AHEAD[self.dir];
  const sign = direction === 'forward' ? 1 : -1;
  const to = { x: self.cell.x + v.dx * sign, y: self.cell.y + v.dy * sign };
  const known = view.knownTerrain.some(
    (entry) => entry.kind === 'floor' && entry.x === to.x && entry.y === to.y,
  );
  return known ? to : null;
}

export function moveLeadActive(lead: MoveLead | null) {
  return lead !== null && lead.ageMs < PRODUCT_ACTION_MS.move + MOVE_LEAD_GRACE_MS;
}

const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/** 보여 줄 칸 좌표(칸 단위). 예측이 맞지 않는 상태면 서버 좌표 `at`을 그대로 돌려준다. */
export function leadPosition(
  at: { x: number; z: number },
  self: { cell: Cell; dir: Dir; action?: Action | null },
  lead: MoveLead | null,
  tick: number | null,
) {
  if (!lead || !moveLeadActive(lead)) return at;
  const local = Math.min(1, Math.max(0, lead.ageMs / PRODUCT_ACTION_MS.move));
  const action = self.action;
  let shown: number;
  if (action?.kind === 'move' && same(action.from, lead.from) && same(action.to, lead.to)) {
    const server =
      tick === null
        ? 0
        : Math.min(
            1,
            Math.max(0, (tick - action.startTick) / Math.max(1, action.endTick - action.startTick)),
          );
    shown = Math.max(local, server);
  } else if (!action && same(self.cell, lead.from) && self.dir === lead.dir) shown = local;
  else return at;
  return {
    x: lead.from.x + (lead.to.x - lead.from.x) * shown,
    z: lead.from.y + (lead.to.y - lead.from.y) * shown,
  };
}
