import { randomUUID } from 'node:crypto';
import type { Role } from '@kkakkung/protocol/game-schema';

/**
 * S15P21C204-340. Enemy players leave the server under an opaque per-round alias.
 *
 * A visible enemy used to carry its real playerId. Enemy roles never leave the server, but the
 * roster gives every client the full playerId → nickname table, and a visible player without an
 * allied role marker is an enemy by elimination: together they told a client exactly which
 * roster members stand on the other team. The alias is stable for the round so the client can
 * still keep one avatar, one face texture and one voice chain per enemy, and it is minted from
 * random bytes so it cannot be traced back to the roster.
 *
 * The same alias must be used everywhere the client keys by playerId — the visible entities of
 * a private view, the media bindings (face and voice tracks) and the audio policy voices —
 * because the client joins those three by id. A player always sees its own and its allies' real
 * ids: allied ids drive exchange requests and spectating and are already public between allies.
 */
export type EnemyAliases = Readonly<{
  /** The alias for `playerId`, minted on first use and stable until `clear()`. */
  aliasOf(playerId: string): string;
  /**
   * The id `receiverId` may see for `playerId`. The real id for the receiver itself, for an
   * ally, or when either role is unknown (nothing to compare, so the known behaviour is kept);
   * the alias for an enemy.
   */
  visibleId(
    playerId: string,
    playerRole: Role | null | undefined,
    receiverId: string,
    receiverRole: Role | null | undefined,
  ): string;
  /** Forgets every alias. The next round mints fresh ones. */
  clear(): void;
}>;

export const ENEMY_ALIAS_PREFIX = 'anon-';

export function createEnemyAliases(
  mint: () => string = () => randomUUID().replace(/-/g, '').slice(0, 12),
): EnemyAliases {
  const aliases = new Map<string, string>();
  const aliasOf = (playerId: string): string => {
    let alias = aliases.get(playerId);
    if (alias === undefined) {
      alias = `${ENEMY_ALIAS_PREFIX}${mint()}`;
      aliases.set(playerId, alias);
    }
    return alias;
  };
  return {
    aliasOf,
    visibleId(playerId, playerRole, receiverId, receiverRole) {
      if (playerId === receiverId) return playerId;
      if (!playerRole || !receiverRole || playerRole === receiverRole) return playerId;
      return aliasOf(playerId);
    },
    clear() {
      aliases.clear();
    },
  };
}
