import type { Role } from '@kkakkung/protocol/game-schema';

export type AvatarAvailability =
  Readonly<{ status: 'loading' | 'fallback' }> | Readonly<{ status: 'ready'; role: Role }>;

export function roleAssetRequest(player: Readonly<{ role?: Role }>) {
  return player.role ?? null;
}

export function resolveAvatarState(
  player: Readonly<{ role?: Role }>,
  availability: AvatarAvailability,
): Role | 'neutral' {
  const role = roleAssetRequest(player);
  return availability.status === 'ready' && role === availability.role ? role : 'neutral';
}
