import type { PlayerState, SandboxState } from '@kkakkung/protocol/schema';

import type { PlayerView } from './store';

export function collectPlayerViews(state: SandboxState | undefined): PlayerView[] | undefined {
  if (!state?.players) return undefined;
  const players: PlayerView[] = [];
  state.players.forEach((player: PlayerState) =>
    players.push({
      playerId: player.playerId,
      nickname: player.nickname,
      x: player.x,
      z: player.z,
    }),
  );
  return players;
}
