/**
 * Deterministic, side-effect-free randomness. The server injects a uint32 seed;
 * every function returns the next state instead of mutating anything, so the
 * same seed and call order always produce the same values.
 */
export type RngState = Readonly<{ value: number }>;

export function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;
}

export function createRng(seed: number): RngState {
  if (!isUint32(seed)) throw new RangeError('seed must be a uint32 integer');
  return Object.freeze({ value: seed >>> 0 });
}

/** mulberry32 step. Returns a float in [0, 1). */
export function nextRandom(state: RngState): Readonly<{ state: RngState; value: number }> {
  let t = (state.value + 0x6d2b79f5) >>> 0;
  const nextState = Object.freeze({ value: t });
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: nextState, value };
}

/** Integer in [0, boundExclusive). boundExclusive must be a positive integer. */
export function nextInt(
  state: RngState,
  boundExclusive: number,
): Readonly<{ state: RngState; value: number }> {
  if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
    throw new RangeError('boundExclusive must be a positive integer');
  }
  const step = nextRandom(state);
  return { state: step.state, value: Math.floor(step.value * boundExclusive) };
}

/** Fisher-Yates shuffle producing a new array; the input is not modified. */
export function shuffle<T>(
  state: RngState,
  items: readonly T[],
): Readonly<{ state: RngState; items: T[] }> {
  const result = [...items];
  let current = state;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const step = nextInt(current, i + 1);
    current = step.state;
    const j = step.value;
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return { state: current, items: result };
}

/** Picks one element; throws on an empty list so callers handle emptiness explicitly. */
export function pick<T>(
  state: RngState,
  items: readonly T[],
): Readonly<{ state: RngState; value: T }> {
  if (items.length === 0) throw new RangeError('cannot pick from an empty list');
  const step = nextInt(state, items.length);
  return { state: step.state, value: items[step.value] as T };
}

/** FNV-1a 32-bit hash of a string, hex encoded. Used for deterministic identifiers. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
