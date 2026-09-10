import type { Action, ActiveSelf } from '@kkakkung/protocol/game-schema';
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
  };
}
export function sampleSelf(self: ActiveSelf, tick: number | null) {
  return self.action && tick !== null
    ? sampleAction(self.action, tick)
    : { x: self.cell.x, z: self.cell.y, yaw: directionYaw(self.dir) };
}
