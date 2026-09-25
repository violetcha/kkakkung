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

/**
 * S15P21C204-399. 이동 키를 누른 채 걸으면 서버는 칸에 닿은 그 틱에 다음 칸 이동을 시작한다. 그
 * 소식은 네트워크 지연만큼 늦게 오므로, 그 사이 화면은 칸 끝에 섰다가 소식이 오면 지연만큼 튀었다.
 * 600ms마다 덜컹거린 이유다. 서버가 이어 걸을 것이 확실할 때만 다음 칸으로 조금 먼저 걸어 둔다.
 *
 * 확실한 경우: 누르고 있는 방향이 지금 이동 방향과 같고, 다음 칸이 내가 아는 통로이고, 도전·설치·
 * 구속 중이 아니고, 이번 이동 중에 회전을 보내지 않았다(서버가 회전을 먼저 한다). 서버 소식이
 * 오면 그 이동이 같은 자리에서 이어지므로 끊김 없이 넘어간다. 틀리면 최대 `MOVE_CHAIN_MAX_TICKS`
 * 만큼만 앞서 있다가 서버 위치로 돌아온다.
 */
export const MOVE_CHAIN_MAX_TICKS = 4;

export type MoveChain = Readonly<{ to: Cell; next: Cell; endTick: number; lengthTicks: number }>;

export function moveChainTarget(
  view: PrivateView | null,
  held: 'forward' | 'back' | null,
  turnSentBeforeTick: number | null,
): MoveChain | null {
  const self = view?.self;
  if (!view || !held || self?.status !== 'ACTIVE') return null;
  const action = self.action;
  if (action?.kind !== 'move' || self.challenge || self.installation) return null;
  if (self.restraintUntilTick !== null && self.restraintUntilTick > action.endTick) return null;
  if (turnSentBeforeTick === action.endTick) return null;
  const dx = action.to.x - action.from.x;
  const dy = action.to.y - action.from.y;
  const v = AHEAD[self.dir];
  const sign = held === 'forward' ? 1 : -1;
  if (dx !== v.dx * sign || dy !== v.dy * sign) return null;
  const next = { x: action.to.x + dx, y: action.to.y + dy };
  const known = view.knownTerrain.some(
    (entry) => entry.kind === 'floor' && entry.x === next.x && entry.y === next.y,
  );
  if (!known) return null;
  return {
    to: { x: action.to.x, y: action.to.y },
    next,
    endTick: action.endTick,
    lengthTicks: Math.max(1, action.endTick - action.startTick),
  };
}

/** 이번 이동이 끝난 뒤 서버 소식을 기다리는 동안 보여 줄 칸 좌표. 해당이 없으면 `at` 그대로. */
export function chainPosition(
  at: { x: number; z: number },
  self: { action?: Action | null },
  chain: MoveChain | null,
  tick: number | null,
) {
  const action = self.action;
  if (!chain || tick === null || action?.kind !== 'move') return at;
  if (action.endTick !== chain.endTick || !same(action.to, chain.to)) return at;
  const over = tick - chain.endTick;
  if (over <= 0) return at;
  const t = Math.min(over, MOVE_CHAIN_MAX_TICKS) / chain.lengthTicks;
  return {
    x: chain.to.x + (chain.next.x - chain.to.x) * t,
    z: chain.to.y + (chain.next.y - chain.to.y) * t,
  };
}

/** 카메라와 손전등이 함께 쓰는 내 위치(칸 좌표): 출발 선반영 뒤에 이어 걷기 선반영을 얹는다. */
export function shownSelfPosition(
  at: { x: number; z: number },
  self: { cell: Cell; dir: Dir; action?: Action | null },
  lead: MoveLead | null,
  chain: MoveChain | null,
  tick: number | null,
) {
  return chainPosition(leadPosition(at, self, lead, tick), self, chain, tick);
}
