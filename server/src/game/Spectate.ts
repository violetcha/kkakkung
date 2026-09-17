import type { GameSubject, SpectatorLink } from './ports.js';

/**
 * S15P21C204-269. Who watches whom after a personal end. An ended runner (captured or escaped)
 * watches a surviving runner of the same team: their chosen one while it is still ACTIVE,
 * otherwise the first surviving runner in roster order. Taggers never end early and never
 * spectate; nobody spectates an enemy. The rules are untouched: this is a server-side read of
 * the frame, and the target's own view is what the spectator receives.
 */
export function spectateCandidates(
  participants: readonly GameSubject[],
  spectatorId: string,
): string[] {
  return participants
    .filter((p) => p.playerId !== spectatorId && p.role === 'runner' && p.status === 'ACTIVE')
    .map((p) => p.playerId);
}

export function isSpectator(participants: readonly GameSubject[], playerId: string): boolean {
  const self = participants.find((p) => p.playerId === playerId);
  return !!self && self.role === 'runner' && self.status !== 'ACTIVE';
}

/** The target to watch, or null when nobody is left to watch (the round is ending anyway). */
export function chooseSpectateTarget(
  participants: readonly GameSubject[],
  spectatorId: string,
  preferred: string | null | undefined,
): string | null {
  if (!isSpectator(participants, spectatorId)) return null;
  const candidates = spectateCandidates(participants, spectatorId);
  if (preferred && candidates.includes(preferred)) return preferred;
  return candidates[0] ?? null;
}

/** Every ended runner paired with its current target, for the media frame. */
export function spectatorLinks(
  participants: readonly GameSubject[],
  preferences: ReadonlyMap<string, string>,
): SpectatorLink[] {
  const links: SpectatorLink[] = [];
  for (const p of participants) {
    const targetId = chooseSpectateTarget(participants, p.playerId, preferences.get(p.playerId));
    if (targetId) links.push({ playerId: p.playerId, targetId });
  }
  return links;
}
