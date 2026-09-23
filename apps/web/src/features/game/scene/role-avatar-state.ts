import type { Role } from '@kkakkung/protocol/game-schema';

export type AvatarAvailability =
  Readonly<{ status: 'loading' | 'fallback' }> | Readonly<{ status: 'ready'; role: Role }>;

export function roleAssetRequest(
  player: Readonly<{ role?: Role }>,
  observerRole: Role | null = null,
) {
  if (player.role) return player.role;
  if (observerRole === 'runner') return 'tagger';
  if (observerRole === 'tagger') return 'runner';
  return null;
}

export function resolveAvatarState(
  player: Readonly<{ role?: Role }>,
  availability: AvatarAvailability,
  observerRole: Role | null = null,
): Role | 'neutral' {
  const role = roleAssetRequest(player, observerRole);
  return availability.status === 'ready' && role === availability.role ? role : 'neutral';
}
