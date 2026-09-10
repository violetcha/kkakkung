import { expect, it } from 'vitest';
import { createPoseHold, matchesPose } from './pose-evaluator';
import { poseFixture } from './pose-fixture';
it('uses canonical arms consistently under mirror display and requires visible joints', () => {
  for (const kind of ['left', 'right', 'y'] as const) {
    const sample = poseFixture(0, kind).pose!;
    if (sample.status !== 'valid') throw Error();
    expect(matchesPose(sample.data, kind)).toBe(true);
    expect(
      matchesPose(
        { ...sample.data, landmarks: sample.data.landmarks.map((p) => ({ ...p, x: 1 - p.x })) },
        kind,
      ),
    ).toBe(true);
    expect(matchesPose({ ...sample.data, quality: 'uncertain' }, kind)).toBe(false);
    expect(
      matchesPose(
        { ...sample.data, landmarks: sample.data.landmarks.map((p) => ({ ...p, visibility: 0 })) },
        kind,
      ),
    ).toBe(false);
  }
});
it('counts only consecutive fresh frames, resetting on invalid, old generation and 301ms gaps', () => {
  const hold = createPoseHold();
  for (let t = 0; t <= 900; t += 300) hold.observe(poseFixture(t), 1, 'left', t);
  expect(hold.observe(poseFixture(1199), 1, 'left', 1199).heldMs).toBe(1199);
  expect(hold.observe(poseFixture(1199), 1, 'left', 1200).freshFrame).toBe(false);
  expect(hold.observe(poseFixture(1200, 'right'), 1, 'left', 1200).heldMs).toBe(0);
  hold.observe(poseFixture(1300), 1, 'left', 1300);
  expect(hold.observe(poseFixture(1601), 1, 'left', 1601).heldMs).toBe(0);
  expect(hold.observe(poseFixture(1900), 2, 'left', 1900).heldMs).toBe(0);
  expect(hold.observe(poseFixture(1900), 1, 'left', 2201).heldMs).toBe(0);
});
