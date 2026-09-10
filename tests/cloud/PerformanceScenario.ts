// F-03 / QA-02. Pure summary of a combined-load performance run on one device: the three
// MediaPipe models at their 15/10/8 fps cadences, the R3F render loop, the 160×160 10 fps
// processed face upload and five remote faces. It decides FPS targets per preset, detects
// overlapping inference and unbounded queues, separates comparison intervals (one model at a
// time, media off, 3D off) and refuses to call a headless software-render sample a device
// result. Judged on fixtures in tests/contracts/performance-summary.test.ts; real samples come
// from tests/cloud/performance.cloud.test.ts on a representative device.
export type Distribution = Readonly<{
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}>;

/** Upper-rank quantile; the p99 of a small sample reflects its slowest values, never the mean. */
function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * (sorted.length - 1)))]!;
}

function describe(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

export const PERFORMANCE_TARGET = Object.freeze({
  fpsByPreset: { mid: 45, low: 30 },
  modelCadenceFps: { face: 15, pose: 10, hand: 8 },
  remoteFaces: 5,
  uploadFps: 10,
  /** A queue that never drains within a second of samples is unbounded. */
  maxQueueDepth: 3,
});

export type InferenceSample = Readonly<{
  atMs: number;
  model: 'face' | 'pose' | 'hand';
  /** Frame the inference ran on; two models on the same frame in the same tick is an overlap. */
  frameId: number;
  durationMs: number;
  queueDepth: number;
}>;

export type FrameSample = Readonly<{ atMs: number; fps: number }>;

export type PerformanceInterval = Readonly<{
  label: 'full' | 'face-only' | 'pose-only' | 'hand-only' | 'media-off' | '3d-off';
  frames: readonly FrameSample[];
  inference: readonly InferenceSample[];
  /** WebRTC encode/decode fps and bitrate observed, or null when media is off. */
  media: Readonly<{
    encodeFps: number;
    decodeFps: number;
    bitrateKbps: number;
    remoteFaces: number;
  }> | null;
}>;

export type DeviceContext = Readonly<{
  preset: 'mid' | 'low';
  /** From navigator/WebGL: the renderer string and whether it is a software rasterizer. */
  renderer: string;
  softwareRenderer: boolean;
  headless: boolean;
  representativeDevice: boolean;
  gpuAccelerated: boolean;
}>;

export type IntervalSummary = Readonly<{
  label: PerformanceInterval['label'];
  fps: Distribution | null;
  inferenceMs: Readonly<Record<'face' | 'pose' | 'hand', Distribution | null>>;
  maxQueueDepth: number;
  overlaps: number;
  media: PerformanceInterval['media'];
}>;

export type PerformanceVerdict = Readonly<{
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'INCOMPLETE';
  reasons: readonly string[];
  intervals: readonly IntervalSummary[];
  /** FPS cost of adding five remote faces (full minus media-off), or null when not measurable. */
  mediaCostFps: number | null;
  presetSuggestion: string | null;
}>;

function summarizeInterval(interval: PerformanceInterval): IntervalSummary {
  const byModel = { face: [] as number[], pose: [] as number[], hand: [] as number[] };
  const perFrame = new Map<number, Set<string>>();
  let overlaps = 0;
  let maxQueue = 0;
  for (const s of interval.inference) {
    byModel[s.model].push(s.durationMs);
    maxQueue = Math.max(maxQueue, s.queueDepth);
    const models = perFrame.get(s.frameId) ?? new Set();
    if (models.size > 0) overlaps++;
    models.add(s.model);
    perFrame.set(s.frameId, models);
  }
  return {
    label: interval.label,
    fps: interval.frames.length ? describe(interval.frames.map((f) => f.fps)) : null,
    inferenceMs: {
      face: byModel.face.length ? describe(byModel.face) : null,
      pose: byModel.pose.length ? describe(byModel.pose) : null,
      hand: byModel.hand.length ? describe(byModel.hand) : null,
    },
    maxQueueDepth: maxQueue,
    overlaps,
    media: interval.media,
  };
}

export function evaluatePerformance(
  device: DeviceContext,
  intervals: readonly PerformanceInterval[],
): PerformanceVerdict {
  const summaries = intervals.map(summarizeInterval);
  const reasons: string[] = [];
  // Headless or software rendering can only ever be a fixture measurement.
  if (
    !device.representativeDevice ||
    device.headless ||
    device.softwareRenderer ||
    !device.gpuAccelerated
  ) {
    reasons.push(
      `not a representative-device measurement (representative=${device.representativeDevice}, headless=${device.headless}, softwareRenderer=${device.softwareRenderer}, gpu=${device.gpuAccelerated}); fixture only`,
    );
    return {
      status: 'BLOCKED',
      reasons,
      intervals: summaries,
      mediaCostFps: null,
      presetSuggestion: null,
    };
  }
  const full = summaries.find((s) => s.label === 'full');
  if (!full || !full.fps) {
    reasons.push('no full-load interval recorded');
    return {
      status: 'INCOMPLETE',
      reasons,
      intervals: summaries,
      mediaCostFps: null,
      presetSuggestion: null,
    };
  }
  const target = PERFORMANCE_TARGET.fpsByPreset[device.preset];
  if (full.fps.mean < target)
    reasons.push(
      `full-load fps mean ${full.fps.mean.toFixed(1)} below ${device.preset} target ${target}`,
    );
  if (full.overlaps > 0)
    reasons.push(`${full.overlaps} frames ran more than one model (inference overlap)`);
  if (full.maxQueueDepth > PERFORMANCE_TARGET.maxQueueDepth)
    reasons.push(
      `inference queue reached ${full.maxQueueDepth} (> ${PERFORMANCE_TARGET.maxQueueDepth}): unbounded growth`,
    );
  if (!full.media || full.media.remoteFaces < PERFORMANCE_TARGET.remoteFaces)
    reasons.push(
      `full interval had ${full.media?.remoteFaces ?? 0} remote faces, ${PERFORMANCE_TARGET.remoteFaces} required`,
    );
  const mediaOff = summaries.find((s) => s.label === 'media-off');
  const mediaCostFps = mediaOff?.fps && full.fps ? mediaOff.fps.mean - full.fps.mean : null;
  const missingComparisons = (
    ['face-only', 'pose-only', 'hand-only', 'media-off', '3d-off'] as const
  ).filter((l) => !summaries.some((s) => s.label === l));
  const incomplete = missingComparisons.length > 0;
  let presetSuggestion: string | null = null;
  if (full.fps.mean < target) {
    presetSuggestion =
      device.preset === 'mid'
        ? '128×128 8 fps upload / 30 fps render preset for D/C (VI-05); measure again before changing defaults'
        : 'low preset already below 30 fps: reduce model cadence or remote face count per D/C decision';
  }
  const status = reasons.length ? 'FAIL' : incomplete ? 'INCOMPLETE' : 'PASS';
  if (incomplete) reasons.push(`comparison intervals missing: ${missingComparisons.join(', ')}`);
  return { status, reasons, intervals: summaries, mediaCostFps, presetSuggestion };
}
