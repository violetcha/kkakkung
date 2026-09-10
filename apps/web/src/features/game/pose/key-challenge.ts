export const DIRECTIONS = ['up', 'right', 'down', 'left'] as const;
export type ChallengeKey = (typeof DIRECTIONS)[number];
/** Server challenge IDs are ASCII; FNV-1a32 fixes this order for the entire challenge. */
export function challengeKeys(challengeId: string): readonly ChallengeKey[] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < challengeId.length; i++)
    hash = Math.imul(hash ^ challengeId.charCodeAt(i), 0x01000193) >>> 0;
  const offset = hash % 4;
  return [...DIRECTIONS.slice(offset), ...DIRECTIONS.slice(0, offset)];
}
export function advanceKey(
  sequence: readonly ChallengeKey[],
  index: number,
  key: ChallengeKey,
  repeat = false,
) {
  if (repeat || index >= sequence.length) return index;
  return sequence[index] === key ? index + 1 : 0;
}
