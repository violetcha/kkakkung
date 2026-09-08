import type { GameState, Player } from '@kkakkung/protocol/game-schema';
import type { PlayerView } from './store';

export function collectTeamPlayers(state: GameState | undefined): PlayerView[] | undefined {
  if (!state?.players) return undefined;
  const players: PlayerView[] = [];
  state.players.forEach((player: Player) =>
    players.push({
      playerId: player.id,
      nickname: `${player.role === 'tagger' ? '술래' : '도망자'} · ${player.id.slice(0, 6)}`,
      role: player.role,
      ready: player.ready,
      x: player.x - 15.5,
      z: player.y - 15.5,
    }),
  );
  return players;
}
