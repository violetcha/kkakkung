import { PlayerState, SandboxState } from '@kkakkung/protocol/schema';
import type { WorldState } from '@kkakkung/game-core';

/** Public sandbox only. Add recipient-specific projection before implementing hidden gameplay. */
export function projectSandbox(world: WorldState, target: SandboxState) {
  target.tick = world.tick;
  for (const id of target.players.keys()) {
    if (!Object.hasOwn(world.players, id)) target.players.delete(id);
  }
  for (const player of Object.values(world.players)) {
    let view = target.players.get(player.id);
    if (!view) {
      view = new PlayerState();
      view.playerId = player.id;
      view.nickname = player.nickname;
      target.players.set(player.id, view);
    }
    view.x = player.x;
    view.z = player.z;
  }
}
