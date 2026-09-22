import type { Action, Cell, Dir } from '@kkakkung/protocol/game-schema';
import { directionYaw } from './scene-model';
export function sampleAction(action: Action, tick: number) {
  const alpha = Math.min(
    1,
    Math.max(0, (tick - action.startTick) / Math.max(1, action.endTick - action.startTick)),
  );
  const turn = ((action.to.dir - action.from.dir + 6) % 4) - 2;
  return {
    x: action.from.x + (action.to.x - action.from.x) * alpha,
    z: action.from.y + (action.to.y - action.from.y) * alpha,
    yaw: directionYaw(action.from.dir) - ((turn * Math.PI) / 2) * alpha,
    // S15P21C204-262. 이동 진행도. 걷기 모션이 같은 값에서 파생되며 위치·방향에는 영향이 없다.
    stride: action.kind === 'move' ? alpha : null,
  };
}
/** The head, face and body share this one authoritative transform. No extrapolation. */
export function sampleActor(
  self: { cell: Cell; dir: Dir; action?: Action | null },
  tick: number | null,
) {
  return self.action && tick !== null && Number.isFinite(tick)
    ? sampleAction(self.action, tick)
    : { x: self.cell.x, z: self.cell.y, yaw: directionYaw(self.dir), stride: null };
}
