// F-14 / QA-10. Pure statistics for load evidence. No IO, no timers.

/** Upper-rank quantile (index = ceil(p·(n−1))): the slowest 1 % of 100 samples is p99. NaN when empty. */
export function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * (sorted.length - 1))));
  return sorted[rank] as number;
}

export type Distribution = Readonly<{
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}>;

export function describe(values: readonly number[]): Distribution {
  if (values.length === 0)
    return { count: 0, min: NaN, max: NaN, mean: NaN, p50: NaN, p95: NaN, p99: NaN };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    count: values.length,
    min,
    max,
    mean: sum / values.length,
    p50: quantile(values, 0.5),
    p95: quantile(values, 0.95),
    p99: quantile(values, 0.99),
  };
}

/** Least-squares slope of `bytes` over `atMs`, in bytes per minute. NaN below two points. */
export function slopePerMinute(
  points: readonly Readonly<{ atMs: number; value: number }>[],
): number {
  if (points.length < 2) return Number.NaN;
  const n = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const x = p.atMs / 60_000;
    sx += x;
    sy += p.value;
    sxx += x * x;
    sxy += x * p.value;
  }
  const denominator = n * sxx - sx * sx;
  if (denominator === 0) return Number.NaN;
  return (n * sxy - sx * sy) / denominator;
}

/**
 * Groups same-round samples (identical `atMs` from one coordinator run) and sums them, so ten
 * rooms that each took 2 ms report one 20 ms round. Returns the per-round totals.
 */
export function combinedRounds(samples: readonly Readonly<{ atMs: number; value: number }>[]) {
  const rounds = new Map<number, number>();
  for (const s of samples) rounds.set(s.atMs, (rounds.get(s.atMs) ?? 0) + s.value);
  return [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([, total]) => total);
}
