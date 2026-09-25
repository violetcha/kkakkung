import {
  PRODUCT_ACTION_MS,
  type Action,
  type Cell,
  type Dir,
} from '@kkakkung/protocol/game-schema';
import { directionYaw } from './scene-model';

/**
 * S15P21C204-388. 회전을 보낸 순간 1인칭 카메라가 먼저 돌기 시작한다. 전에는 서버가 회전을 시작한
 * 개인 뷰가 올 때까지(왕복 + 틱 경계) 화면이 가만히 있어서 뻑뻑했다.
 *
 * 서버 판정은 그대로다. 서버 회전이 오면 둘 중 더 나아간 쪽을 그려 뒤로 튀지 않고, 서버 회전이
 * 끝나면 서버 값만 쓴다. 서버가 끝내 회전을 시작하지 않으면(거절) 유예 뒤에 원래 방향으로 돌아온다.
 * `ageMs`는 보낸 뒤 흐른 시간이다. 읽는 쪽이 자기 시계로 계산해 넘긴다.
 */
export type TurnLead = Readonly<{ fromDir: Dir; direction: 'left' | 'right'; ageMs: number }>;

/** 서버 회전 시작을 기다리는 최대 시간. 이 안에 오지 않으면 예측을 버린다. */
export const TURN_LEAD_GRACE_MS = 600;

const targetOf = (lead: TurnLead) =>
  ((lead.fromDir + (lead.direction === 'right' ? 1 : 3)) % 4) as Dir;

/** 아직 서버 회전을 기다리거나 따라가는 중인가. 새 예측을 겹쳐 만들지 않는 데 쓴다. */
export function turnLeadActive(lead: TurnLead | null) {
  return lead !== null && lead.ageMs < PRODUCT_ACTION_MS.turn + TURN_LEAD_GRACE_MS;
}

/** 보여 줄 시선 방향. 예측이 맞지 않는 상태면 서버 방향 `yaw`를 그대로 돌려준다. */
export function leadYaw(
  yaw: number,
  self: { cell: Cell; dir: Dir; action?: Action | null },
  lead: TurnLead | null,
  tick: number | null,
) {
  if (!lead || !turnLeadActive(lead)) return yaw;
  const target = targetOf(lead);
  const local = Math.min(1, Math.max(0, lead.ageMs / PRODUCT_ACTION_MS.turn));
  const action = self.action;
  let shown: number;
  if (action?.kind === 'turn' && action.from.dir === lead.fromDir && action.to.dir === target) {
    const server =
      tick === null
        ? 0
        : Math.min(
            1,
            Math.max(0, (tick - action.startTick) / Math.max(1, action.endTick - action.startTick)),
          );
    shown = Math.max(local, server);
  } else if (!action && self.dir === lead.fromDir) shown = local;
  else return yaw;
  const sign = lead.direction === 'right' ? 1 : -1;
  return directionYaw(lead.fromDir) - ((sign * Math.PI) / 2) * shown;
}
