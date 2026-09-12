import { SENSOR_MAX_AGE_MS, type Sample } from '../vision/sensor-types';
import { createOneEuroFilter } from './one-euro-filter';
import { INPUT_TUNING, type InputTuning } from './input-tuning';

type Observation =
  | { status: 'new'; value: number; sampledAtMs: number; restarted: boolean }
  | { status: 'repeat' | 'unavailable' };

/** A snapshot is a bundle, not a new observation of every sensor in that bundle. */
export function createMotionSampleFilter(
  kind: 'face' | 'pose',
  tuning: InputTuning = INPUT_TUNING,
) {
  const filter = createOneEuroFilter({
    minCutoffHz: tuning.filterMinCutoffHz,
    beta: tuning.filterBeta,
    derivativeCutoffHz: tuning.filterDerivativeCutoffHz,
    maxGapMs: tuning.filterMaxGapMs,
  });
  let generation = -1;
  let cursor: Pick<Sample<unknown>, 'frameId' | 'sampledAtMs'> | null = null;
  let filteredAt: number | null = null;
  let notBeforeMs = -Infinity;
  const reset = (nowMs?: number) => {
    filter.reset();
    filteredAt = null;
    // Preserve the consumed cursor so a context reset cannot revive a cached sample.
    if (nowMs !== undefined) notBeforeMs = Math.max(notBeforeMs, nowMs);
  };
  return {
    reset,
    observe(
      sample: Sample<unknown> | null,
      value: number | null,
      nowMs: number,
      runtimeGeneration: number,
    ): Observation {
      if (runtimeGeneration !== generation) {
        generation = runtimeGeneration;
        cursor = null;
        reset();
      }
      const age = sample ? nowMs - sample.sampledAtMs : Infinity;
      if (
        !sample ||
        !Number.isSafeInteger(sample.frameId) ||
        sample.frameId < 0 ||
        !Number.isFinite(nowMs) ||
        !Number.isFinite(sample.sampledAtMs) ||
        age < 0 ||
        age > SENSOR_MAX_AGE_MS[kind] ||
        sample.sampledAtMs < notBeforeMs
      ) {
        reset();
        return { status: 'unavailable' };
      }
      if (cursor && (sample.frameId <= cursor.frameId || sample.sampledAtMs <= cursor.sampledAtMs))
        return { status: 'repeat' };
      cursor = { frameId: sample.frameId, sampledAtMs: sample.sampledAtMs };
      if (sample.status !== 'valid' || value === null || !Number.isFinite(value)) {
        reset();
        return { status: 'unavailable' };
      }
      const restarted =
        filteredAt === null ||
        sample.sampledAtMs - filteredAt > Math.min(tuning.filterMaxGapMs, SENSOR_MAX_AGE_MS[kind]);
      if (restarted) filter.reset();
      filteredAt = sample.sampledAtMs;
      return {
        status: 'new',
        value: filter.filter(value, sample.sampledAtMs),
        sampledAtMs: sample.sampledAtMs,
        restarted,
      };
    },
  };
}
