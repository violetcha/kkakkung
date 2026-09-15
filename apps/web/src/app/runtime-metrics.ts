import type { FrameMetrics } from '../features/game/scene/FrameMetrics';
import type { MediaStatus, SensorSnapshot } from '../features/input/InteractionRuntime';

/**
 * Collector for the product app's own vision, render and WebRTC timings (W06).
 * It keeps counts and durations only: no frame bytes, no face or voice data and
 * no player identity ever enters a sample. Off by default; a run that does not
 * enable it never allocates a bucket and never records anything, so the normal
 * product path keeps its behaviour.
 */
export type RenderSample = Readonly<{
  atMs: number;
  fps: number;
  p95Ms: number;
  draws: number;
  triangles: number;
  geometries: number;
  textures: number;
}>;

export type VisionModel = 'face' | 'pose' | 'gesture';

/** One model result, timed from the frame it was sampled on to its arrival. */
export type InferenceSample = Readonly<{
  atMs: number;
  model: VisionModel;
  frameId: number;
  durationMs: number;
}>;

/** A WebRTC lifecycle step. `code` is the runtime's own reason string, never a track or identity. */
export type MediaEvent = Readonly<{
  atMs: number;
  kind: 'state' | 'face-track-attached' | 'face-track-detached';
  state?: MediaStatus['state'];
  code?: string | null;
}>;

export type Distribution = Readonly<{
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}>;

export type MatchMetrics = Readonly<{
  matchId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  render: Distribution | null;
  /** Longest single frame of the match, in milliseconds. */
  longestFrameMs: number | null;
  /** Renderer resource counts of the last sample: the input of repeat-match growth. */
  lastResources: Readonly<{
    draws: number;
    triangles: number;
    geometries: number;
    textures: number;
  }> | null;
  inference: Readonly<Partial<Record<VisionModel, Distribution>>>;
  media: readonly MediaEvent[];
  dropped: Readonly<{ render: number; inference: number; media: number }>;
}>;

export type RuntimeMetricsReport = Readonly<{
  enabled: true;
  matches: readonly MatchMetrics[];
  /** Matches evicted after the cap; their samples are gone, the count is not. */
  droppedMatches: number;
}>;

export interface RuntimeMetrics {
  startMatch(matchId: string): void;
  endMatch(): void;
  recordRender(metrics: FrameMetrics): void;
  recordSensors(snapshot: SensorSnapshot): void;
  recordMedia(status: MediaStatus): void;
  recordFaceTrack(attached: boolean): void;
  report(): RuntimeMetricsReport;
  dispose(): void;
}

/** Bounded so a long session cannot grow without limit. */
const LIMITS = Object.freeze({ matches: 8, render: 600, inference: 2000, media: 200 });

function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * (sorted.length - 1)))]!;
}

function describe(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Object.freeze({
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1]!,
  });
}

type Bucket = {
  matchId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  fps: number[];
  frameMs: number[];
  resources: RenderSample | null;
  inference: Map<VisionModel, number[]>;
  media: MediaEvent[];
  dropped: { render: number; inference: number; media: number };
  seen: Set<string>;
};

function newBucket(matchId: string, atMs: number): Bucket {
  return {
    matchId,
    startedAtMs: atMs,
    endedAtMs: null,
    fps: [],
    frameMs: [],
    resources: null,
    inference: new Map(),
    media: [],
    dropped: { render: 0, inference: 0, media: 0 },
    seen: new Set(),
  };
}

export function createRuntimeMetrics(deps: Readonly<{ now(): number }>): RuntimeMetrics {
  const buckets: Bucket[] = [];
  let current: Bucket | null = null;
  let droppedMatches = 0;
  let disposed = false;

  const push = <T>(list: T[], value: T, limit: number, counter: () => void): void => {
    if (list.length >= limit) {
      counter();
      return;
    }
    list.push(value);
  };

  return {
    startMatch(matchId) {
      if (disposed || current?.matchId === matchId) return;
      if (current) current.endedAtMs ??= deps.now();
      current = newBucket(matchId, deps.now());
      buckets.push(current);
      while (buckets.length > LIMITS.matches) {
        buckets.shift();
        droppedMatches += 1;
      }
    },
    endMatch() {
      if (disposed || !current) return;
      current.endedAtMs ??= deps.now();
      current = null;
    },
    recordRender(metrics) {
      if (disposed || !current) return;
      const bucket = current;
      // Both series are bounded by the same guard, so a long match cannot grow
      // one of them past the cap.
      if (bucket.fps.length >= LIMITS.render) bucket.dropped.render += 1;
      else {
        bucket.fps.push(metrics.fps);
        bucket.frameMs.push(metrics.p95Ms);
      }
      // The newest sample always wins: repeat-match growth is read from it.
      bucket.resources = Object.freeze({
        atMs: deps.now(),
        fps: metrics.fps,
        p95Ms: metrics.p95Ms,
        draws: metrics.draws,
        triangles: metrics.triangles,
        geometries: metrics.geometries,
        textures: metrics.textures,
      });
    },
    recordSensors(snapshot) {
      if (disposed || !current) return;
      const bucket = current;
      for (const model of ['face', 'pose', 'gesture'] as const) {
        const sample = snapshot[model];
        // A snapshot repeats its last sample until the next result arrives: the
        // frame id keys the de-duplication so one inference is counted once.
        if (!sample) continue;
        const key = `${model}:${sample.frameId}`;
        if (bucket.seen.has(key)) continue;
        bucket.seen.add(key);
        let durations = bucket.inference.get(model);
        if (!durations) {
          durations = [];
          bucket.inference.set(model, durations);
        }
        push(
          durations,
          Math.max(0, sample.receivedAtMs - sample.sampledAtMs),
          LIMITS.inference,
          () => (bucket.dropped.inference += 1),
        );
      }
    },
    recordMedia(status) {
      if (disposed || !current) return;
      const bucket = current;
      const last = bucket.media.at(-1);
      if (last?.kind === 'state' && last.state === status.state && last.code === status.code)
        return;
      push(
        bucket.media,
        Object.freeze({ atMs: deps.now(), kind: 'state', state: status.state, code: status.code }),
        LIMITS.media,
        () => (bucket.dropped.media += 1),
      );
    },
    recordFaceTrack(attached) {
      if (disposed || !current) return;
      const bucket = current;
      push(
        bucket.media,
        Object.freeze({
          atMs: deps.now(),
          kind: attached ? 'face-track-attached' : 'face-track-detached',
        } as const),
        LIMITS.media,
        () => (bucket.dropped.media += 1),
      );
    },
    report() {
      return Object.freeze({
        enabled: true,
        droppedMatches,
        matches: buckets.map((bucket) => {
          const inference: Partial<Record<VisionModel, Distribution>> = {};
          for (const [model, durations] of bucket.inference) {
            const distribution = describe(durations);
            if (distribution) inference[model] = distribution;
          }
          return Object.freeze({
            matchId: bucket.matchId,
            startedAtMs: bucket.startedAtMs,
            endedAtMs: bucket.endedAtMs,
            render: describe(bucket.fps),
            longestFrameMs: bucket.frameMs.length === 0 ? null : Math.max(...bucket.frameMs),
            lastResources: bucket.resources
              ? Object.freeze({
                  draws: bucket.resources.draws,
                  triangles: bucket.resources.triangles,
                  geometries: bucket.resources.geometries,
                  textures: bucket.resources.textures,
                })
              : null,
            inference: Object.freeze(inference),
            media: Object.freeze([...bucket.media]),
            dropped: Object.freeze({ ...bucket.dropped }),
          });
        }),
      });
    },
    dispose() {
      disposed = true;
      current = null;
      buckets.length = 0;
    },
  };
}

/**
 * Whether this run collects measurements. Only an explicit `?metrics=1` turns it
 * on, so a normal product session never pays for it. The query string is used
 * rather than the hash because the room flow consumes and clears the hash.
 */
export function metricsRequested(search: string): boolean {
  return new URLSearchParams(search).get('metrics') === '1';
}

/**
 * Publishes the report behind a read-only accessor for the F-02 probe harness.
 * Returns the cleanup that removes it again.
 */
export function publishRuntimeMetrics(
  host: Record<string, unknown>,
  metrics: RuntimeMetrics,
): () => void {
  host.__kkakkungMetrics = Object.freeze({ read: () => metrics.report() });
  return () => {
    delete host.__kkakkungMetrics;
  };
}
