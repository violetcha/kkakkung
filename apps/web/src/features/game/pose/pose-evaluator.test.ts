import { expect, it } from 'vitest';
import { createPoseHint, createPoseHold, evaluatePose, matchesPose } from './pose-evaluator';
import { poseFixture } from './pose-fixture';

const data = (snapshot: ReturnType<typeof poseFixture>) => {
  const sample = snapshot.pose;
  if (sample?.status !== 'valid') throw Error();
  return sample.data;
};

it('uses canonical arms consistently under mirror display and requires visible joints', () => {
  for (const kind of ['left', 'right', 'y'] as const) {
    const pose = data(poseFixture(0, kind));
    expect(matchesPose(pose, kind)).toBe(true);
    expect(
      matchesPose({ ...pose, landmarks: pose.landmarks.map((p) => ({ ...p, x: 1 - p.x })) }, kind),
    ).toBe(true);
    expect(evaluatePose({ ...pose, quality: 'uncertain' }, kind)).toEqual({
      matched: false,
      reason: 'trunk',
    });
    expect(
      evaluatePose(
        { ...pose, landmarks: pose.landmarks.map((p) => ({ ...p, visibility: 0 })) },
        kind,
      ),
    ).toEqual({ matched: false, reason: 'trunk' });
  }
});

it('judges a one-arm pose from the raised arm alone, so a lowered arm may leave the frame', () => {
  for (const kind of ['left', 'right'] as const) {
    expect(matchesPose(data(poseFixture(0, kind, 0, { idleArmOffscreen: true })), kind)).toBe(true);
    expect(evaluatePose(data(poseFixture(0, kind, 0, { raisedArmOffscreen: true })), kind)).toEqual(
      {
        matched: false,
        reason: 'arm-offscreen',
      },
    );
  }
  // Y자는 두 팔이 모두 필요하다. 한쪽이 화면 밖이면 성립하지 않는다.
  expect(evaluatePose(data(poseFixture(0, 'y', 0, { raisedArmOffscreen: true })), 'y')).toEqual({
    matched: false,
    reason: 'arm-offscreen',
  });
});

it('accepts a raised forearm with the elbow at shoulder height', () => {
  for (const kind of ['left', 'right', 'y'] as const)
    expect(matchesPose(data(poseFixture(0, kind, 0, { elbowAtShoulder: true })), kind)).toBe(true);
});

it('names why a pose does not stand', () => {
  // 팔을 내린 상태: 손목이 어깨 위로 올라오지 않았다.
  expect(evaluatePose(data(poseFixture(0, 'right')), 'left')).toEqual({
    matched: false,
    reason: 'arm-low',
  });
  // 한 팔만 드는 자세인데 반대 팔도 올라가 있다.
  expect(evaluatePose(data(poseFixture(0, 'y')), 'left')).toEqual({
    matched: false,
    reason: 'other-arm',
  });
  // Y자인데 두 손목이 바깥으로 벌어지지 않았다.
  const tucked = data(poseFixture(0, 'y'));
  const landmarks = tucked.landmarks.map((point, index) =>
    index === 15 ? { ...point, x: 0.55 } : index === 16 ? { ...point, x: 0.45 } : point,
  );
  expect(evaluatePose({ ...tucked, landmarks }, 'y')).toEqual({
    matched: false,
    reason: 'arm-spread',
  });
});

it('counts only fresh frames, resetting on an old generation and a 301ms sample gap', () => {
  const hold = createPoseHold();
  for (let t = 0; t <= 900; t += 300) hold.observe(poseFixture(t), 1, 'left', t);
  expect(hold.observe(poseFixture(1199), 1, 'left', 1199).heldMs).toBe(1199);
  expect(hold.observe(poseFixture(1199), 1, 'left', 1200).freshFrame).toBe(false);
  hold.observe(poseFixture(1300), 1, 'left', 1300);
  expect(hold.observe(poseFixture(1601), 1, 'left', 1601).heldMs).toBe(0);
  expect(hold.observe(poseFixture(1900), 2, 'left', 1900).heldMs).toBe(0);
  expect(hold.observe(poseFixture(1900), 1, 'left', 2201).heldMs).toBe(0);
});

it('keeps the hold through a short break without counting the broken span', () => {
  const hold = createPoseHold();
  for (let t = 0; t <= 800; t += 100) hold.observe(poseFixture(t), 1, 'left', t);
  expect(hold.observe(poseFixture(800), 1, 'left', 800).heldMs).toBe(800);
  // 150ms 동안 자세가 깨진다. 누적은 살아 있고 그 구간은 시간으로 세지 않는다.
  expect(hold.observe(poseFixture(900, 'right'), 1, 'left', 900).heldMs).toBe(800);
  expect(hold.observe(poseFixture(950, 'right'), 1, 'left', 950).reason).toBe('arm-low');
  expect(hold.observe(poseFixture(1000), 1, 'left', 1000).heldMs).toBe(800);
  expect(hold.observe(poseFixture(1100), 1, 'left', 1100).heldMs).toBe(900);
});

it('drops the hold when the break outlasts the grace', () => {
  const hold = createPoseHold();
  for (let t = 0; t <= 800; t += 100) hold.observe(poseFixture(t), 1, 'left', t);
  expect(hold.observe(poseFixture(900, 'right'), 1, 'left', 900).heldMs).toBe(800);
  expect(hold.observe(poseFixture(1001, 'right'), 1, 'left', 1001).heldMs).toBe(0);
  expect(hold.observe(poseFixture(1100), 1, 'left', 1100).heldMs).toBe(0);
});

it('raises a hint only after the same reason has lasted, and clears it the moment the pose stands', () => {
  const hint = createPoseHint();
  expect(hint.observe('arm-offscreen', 0)).toBe(null);
  expect(hint.observe('arm-offscreen', 499)).toBe(null);
  expect(hint.observe('arm-offscreen', 500)).toBe('arm-offscreen');
  // 이유가 바뀌면 다시 잰다. 그 사이에는 앞서 세운 문구를 유지해 깜빡이지 않는다.
  expect(hint.observe('arm-low', 600)).toBe('arm-offscreen');
  expect(hint.observe('arm-low', 1100)).toBe('arm-low');
  expect(hint.observe(null, 1101)).toBe(null);
  expect(hint.observe('arm-low', 1102)).toBe(null);
});
