// F-03 / QA-02 summary judgement on synthetic samples: FPS targets per preset, inference overlap
// and queue growth, the cost of five remote faces as a separate comparison, and the rule that a
// headless software render never counts as a device pass. No browser, no model download.
import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_TARGET,
  evaluatePerformance,
  type DeviceContext,
  type InferenceSample,
  type PerformanceInterval,
} from '../../tests/cloud/PerformanceScenario.ts';

const device = (over: Partial<DeviceContext> = {}): DeviceContext => ({
  preset: 'mid',
  renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU)',
  softwareRenderer: false,
  headless: false,
  representativeDevice: true,
  gpuAccelerated: true,
  ...over,
});

function inference(seconds: number, overlapEvery = 0, queueSpike = 0): InferenceSample[] {
  const out: InferenceSample[] = [];
  let frame = 0;
  for (let t = 0; t < seconds * 1000; t += 1000 / 60) {
    frame++;
    const models: ('face' | 'pose' | 'hand')[] = [];
    if (frame % 4 === 0) models.push('face');
    else if (frame % 6 === 0) models.push('pose');
    else if (frame % 8 === 0) models.push('hand');
    if (overlapEvery && frame % overlapEvery === 0) models.push('pose');
    for (const model of models)
      out.push({
        atMs: t,
        model,
        frameId: frame,
        durationMs: model === 'face' ? 9 : 14,
        queueDepth: queueSpike && frame % 30 === 0 ? queueSpike : 1,
      });
  }
  return out;
}

const frames = (seconds: number, fps: number) =>
  Array.from({ length: seconds * 4 }, (_, i) => ({ atMs: i * 250, fps }));

function intervals(
  fullFps = 52,
  over: Partial<Record<PerformanceInterval['label'], Partial<PerformanceInterval>>> = {},
): PerformanceInterval[] {
  const base = (
    label: PerformanceInterval['label'],
    fps: number,
    media: PerformanceInterval['media'],
  ): PerformanceInterval => ({
    label,
    frames: frames(20, fps),
    inference: inference(20),
    media,
    ...over[label],
  });
  const media = { encodeFps: 10, decodeFps: 50, bitrateKbps: 900, remoteFaces: 5 };
  return [
    base('full', fullFps, media),
    base('face-only', 58, media),
    base('pose-only', 57, media),
    base('hand-only', 58, media),
    base('media-off', 59, null),
    base('3d-off', 60, media),
  ];
}

describe('combined-load performance judgement', () => {
  it('a representative mid device at 52 fps with five remote faces and no overlap passes and reports the media cost', () => {
    const v = evaluatePerformance(device(), intervals());
    expect(v.status).toBe('PASS');
    expect(v.mediaCostFps).toBe(7);
    expect(v.intervals.find((i) => i.label === 'full')).toMatchObject({
      overlaps: 0,
      maxQueueDepth: 1,
    });
    expect(v.presetSuggestion).toBeNull();
  });

  it('all three models at their cadence: overlapping inference on one frame or a growing queue fails', () => {
    const overlap = evaluatePerformance(
      device(),
      intervals(52, { full: { inference: inference(20, 12) } }),
    );
    expect(overlap.status).toBe('FAIL');
    expect(overlap.reasons.join(' ')).toMatch(/inference overlap/);
    const queue = evaluatePerformance(
      device(),
      intervals(52, { full: { inference: inference(20, 0, 9) } }),
    );
    expect(queue.reasons.join(' ')).toMatch(/queue reached 9 .* unbounded/);
    expect(PERFORMANCE_TARGET.modelCadenceFps).toEqual({ face: 15, pose: 10, hand: 8 });
  });

  it('five remote faces are required in the full interval and their cost is an independent comparison sample', () => {
    const v = evaluatePerformance(
      device(),
      intervals(52, {
        full: { media: { encodeFps: 10, decodeFps: 30, bitrateKbps: 500, remoteFaces: 3 } },
      }),
    );
    expect(v.status).toBe('FAIL');
    expect(v.reasons.join(' ')).toMatch(/3 remote faces, 5 required/);
    const noComparison = evaluatePerformance(
      device(),
      intervals().filter((i) => i.label !== 'media-off'),
    );
    expect(noComparison.status).toBe('INCOMPLETE');
    expect(noComparison.mediaCostFps).toBeNull();
  });

  it('a low device under 30 fps is recorded as below target with a preset suggestion for D/C', () => {
    const v = evaluatePerformance(device({ preset: 'low' }), intervals(26));
    expect(v.status).toBe('FAIL');
    expect(v.reasons[0]).toMatch(/fps mean 26.0 below low target 30/);
    expect(v.presetSuggestion).toMatch(/reduce model cadence or remote face count/);
    const mid = evaluatePerformance(device(), intervals(40));
    expect(mid.presetSuggestion).toMatch(/128×128 8 fps/);
  });

  it('headless or software-rendered samples are BLOCKED as device evidence even at 60 fps', () => {
    for (const ctx of [
      device({ headless: true }),
      device({ softwareRenderer: true, renderer: 'SwiftShader' }),
      device({ representativeDevice: false }),
      device({ gpuAccelerated: false }),
    ]) {
      const v = evaluatePerformance(ctx, intervals(60));
      expect(v.status).toBe('BLOCKED');
      expect(v.reasons[0]).toMatch(/fixture only/);
    }
  });
});
