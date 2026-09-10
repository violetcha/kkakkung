import { expect, it, vi } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { createChallengeController, exitCandidate } from './challenge-controller';
import { poseFixture } from './pose-fixture';
function challengeView() {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error();
  return {
    ...view,
    self: {
      ...view.self,
      challenge: {
        challengeId: 'challenge',
        exitId: 'exit',
        poseKind: 'left' as const,
        startedAtTick: 0,
        minSuccessTick: 40,
        expiresAtTick: 160,
      },
    },
  };
}
it('waits for minimum server tick and a fresh pose, sends once and never treats applied as escape', () => {
  const send = vi.fn(() => 'request');
  const controller = createChallengeController(send);
  const view = challengeView();
  for (let t = 0; t <= 1200; t += 200) controller.update(view, 39, t, poseFixture(t), 1);
  expect(send).not.toHaveBeenCalled();
  controller.update(view, 40, 1300, poseFixture(1200), 1);
  expect(send).not.toHaveBeenCalled();
  controller.update(view, 40, 1400, poseFixture(1400), 1);
  expect(send).toHaveBeenCalledTimes(1);
  controller.update(view, 42, 1600, poseFixture(1600), 1, {
    requestId: 'request',
    type: 'EXIT_PROGRESS',
    status: 'applied',
    code: null,
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(view.self.status).toBe('ACTIVE');
});
it('allows one NOT_READY retry after 500ms with new samples and stops after capture', () => {
  const send = vi.fn(() => `request-${send.mock.calls.length}`);
  const controller = createChallengeController(send);
  const view = challengeView();
  for (let t = 0; t <= 1200; t += 200) controller.update(view, 40, t, poseFixture(t), 1);
  const rejection = {
    requestId: 'request-1',
    type: 'EXIT_PROGRESS' as const,
    status: 'rejected' as const,
    code: 'NOT_READY',
  };
  controller.update(view, 40, 1300, poseFixture(1300), 1, rejection);
  controller.update(view, 42, 1500, poseFixture(1500), 1, rejection);
  controller.update(view, 43, 1700, poseFixture(1700), 1, rejection);
  expect(send).toHaveBeenCalledTimes(1);
  controller.update(view, 44, 1800, poseFixture(1800), 1, rejection);
  expect(send).toHaveBeenCalledTimes(2);
  controller.update(
    { ...view, self: { playerId: 'self', role: 'runner', status: 'CAPTURED' } },
    45,
    1900,
    poseFixture(1900),
    1,
  );
  expect(send).toHaveBeenCalledTimes(2);
});
it('only offers an observed owned exit and suppresses progress after cancellation or expiry', () => {
  const view = challengeView();
  expect(exitCandidate(view)?.exitId).toBe('exit');
  expect(exitCandidate({ ...view, visibleWallFaces: [] })).toBeNull();
  const send = vi.fn(() => 'request');
  const controller = createChallengeController(send);
  controller.update(view, 10, 0, poseFixture(0), 1);
  controller.suspend();
  for (let t = 200; t <= 1600; t += 200) controller.update(view, 50, t, poseFixture(t), 1);
  controller.update(view, 160, 1800, poseFixture(1800), 1);
  expect(send).not.toHaveBeenCalled();
});
