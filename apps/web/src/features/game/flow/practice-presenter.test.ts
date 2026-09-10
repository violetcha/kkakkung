import { expect, it } from 'vitest';
import { practicePresenter } from './practice-presenter';
import { INITIAL_DEVICES } from './device-readiness';
import { roundFixture, viewFixture } from '../../room/product-fixture';
it('requires matching practice scope and actual device readiness, independent of time', () => {
  const round = roundFixture({ phase: 'TEAM_PRACTICE', serverTick: 100000 });
  const view = viewFixture({
    gameScope: { kind: 'practice', revision: 1, gameInstanceId: 'practice-team' },
  });
  expect(practicePresenter(round, view, INITIAL_DEVICES)?.canReady).toBe(false);
  expect(practicePresenter(round, viewFixture(), INITIAL_DEVICES)).toBeNull();
  expect(practicePresenter(roundFixture(), view, INITIAL_DEVICES)).toBeNull();
  expect(practicePresenter(round, { ...view, matchId: 'old' }, INITIAL_DEVICES)).toBeNull();
  expect(
    practicePresenter(round, view, {
      ...INITIAL_DEVICES,
      camera: 'ready',
      vision: 'ready',
      calibration: 'ready',
      audioPlayback: 'ready',
    })?.canReady,
  ).toBe(true);
});
