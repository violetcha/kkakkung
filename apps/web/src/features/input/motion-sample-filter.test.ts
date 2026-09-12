import { expect, it } from 'vitest';
import { createMotionSampleFilter } from './motion-sample-filter';
import { createTurnIntentController } from './turn-intent';
import { isSampleFresh } from '../vision/sensor-types';

const sample = (frameId: number, sampledAtMs: number) => ({
  frameId,
  sampledAtMs,
  receivedAtMs: sampledAtMs,
  status: 'valid' as const,
  data: {},
});

it('does not advance a turn hold from another sensor snapshot or repeated frame', () => {
  const filter = createMotionSampleFilter('face');
  const sent: string[] = [];
  const turn = createTurnIntentController({ send: (direction) => sent.push(direction) });
  const observe = (frame: ReturnType<typeof sample>, now: number) => {
    const next = filter.observe(frame, 0.7, now, 1);
    if (next.status === 'new') {
      if (next.restarted) turn.reset();
      turn.updateMotion(next.value, next.sampledAtMs);
    }
    return next;
  };
  observe(sample(1, 1000), 1000);
  expect(observe(sample(1, 1000), 1200).status).toBe('repeat');
  expect(observe(sample(1, 1200), 1200).status).toBe('repeat');
  expect(observe(sample(2, 1000), 1200).status).toBe('repeat');
  expect(sent).toEqual([]);
  observe(sample(3, 1200), 1250);
  expect(sent).toEqual(['right']);
});

it('resets smoothing after missing or stale input and refuses future/non-finite timestamps', () => {
  const filter = createMotionSampleFilter('face');
  filter.observe(sample(1, 1000), 0, 1000, 1);
  expect(filter.observe(sample(2, 1050), 0.7, 1050, 1)).toMatchObject({
    status: 'new',
    restarted: false,
  });
  expect(filter.observe(sample(2, 1050), 0.7, 1351, 1).status).toBe('unavailable');
  expect(filter.observe(sample(3, 1400), -0.7, 1400, 1)).toMatchObject({
    status: 'new',
    restarted: true,
    value: -0.7,
  });
  expect(filter.observe(sample(4, 1450), null, 1450, 1).status).toBe('unavailable');
  expect(filter.observe(sample(5, 1500), 0.7, 1500, 1)).toMatchObject({
    status: 'new',
    restarted: true,
    value: 0.7,
  });
  for (const timestamp of [1600, Infinity, NaN]) {
    const frame = sample(6, timestamp);
    expect(filter.observe(frame, 0.7, 1550, 1).status).toBe('unavailable');
    expect(isSampleFresh(frame, 'face', 1550)).toBe(false);
  }
});

it('keeps independent yaw/lean cursors and does not revive a pre-context sample', () => {
  const face = createMotionSampleFilter('face');
  const pose = createMotionSampleFilter('pose');
  face.observe(sample(1, 1000), 0, 1000, 1);
  pose.observe(sample(1, 1000), 0.3, 1000, 1);
  face.observe(sample(2, 1050), 0.7, 1050, 1);
  expect(pose.observe(sample(1, 1000), 0.3, 1050, 1).status).toBe('repeat');
  face.reset(1100);
  expect(face.observe(sample(3, 1075), 0.7, 1100, 1).status).toBe('unavailable');
  expect(face.observe(sample(4, 1150), -0.7, 1150, 1)).toMatchObject({
    status: 'new',
    restarted: true,
    value: -0.7,
  });
  expect(face.observe(sample(1, 1200), 0.7, 1200, 2)).toMatchObject({
    status: 'new',
    restarted: true,
  });
});

it('reduces stationary jitter while admitting a deliberate turn within a bounded synthetic trace', () => {
  const filter = createMotionSampleFilter('face');
  const turnTimes: number[] = [];
  let now = 0;
  const turn = createTurnIntentController({ send: () => turnTimes.push(now) });
  let rawEnergy = 0;
  let filteredEnergy = 0;
  for (let frame = 1; frame <= 120; frame++) {
    now = frame * 40;
    const raw = frame <= 100 ? 0.08 * Math.sin(frame * 2) : 0.7;
    const result = filter.observe(sample(frame, now), raw, now, 1);
    if (result.status !== 'new') throw Error('fresh observation was rejected');
    turn.updateMotion(result.value, result.sampledAtMs);
    if (frame > 10 && frame <= 100) {
      rawEnergy += raw * raw;
      filteredEnergy += result.value * result.value;
    }
  }
  expect(filteredEnergy).toBeLessThan(rawEnergy * 0.25);
  expect(turnTimes).toHaveLength(1);
  expect(turnTimes[0]! - 4040).toBeGreaterThanOrEqual(150);
  expect(turnTimes[0]! - 4040).toBeLessThanOrEqual(500);
});
