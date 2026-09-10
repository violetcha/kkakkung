import { expect, it, vi } from 'vitest';
import { advanceKey, challengeKeys } from './key-challenge';
import { createChallengeController } from './challenge-controller';
import { viewFixture } from '../../room/product-fixture';
it('keeps the challenge order across errors and ignores key repeat', () => {
  const sequence = challengeKeys('challenge');
  expect(new Set(sequence).size).toBe(4);
  expect(challengeKeys('a')).toEqual(['up', 'right', 'down', 'left']);
  let index = advanceKey(sequence, 0, sequence[0]!);
  expect(advanceKey(sequence, index, sequence[1]!, true)).toBe(1);
  index = advanceKey(sequence, index, sequence[2]!);
  expect(index).toBe(0);
  expect(challengeKeys('challenge')).toEqual(sequence);
});
it('waits for minimum tick, retries NOT_READY once, and only counts authoritative escape as success', () => {
  const base = viewFixture();
  if (base.self?.status !== 'ACTIVE') throw Error();
  const view = {
    ...base,
    self: {
      ...base.self,
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
  const send = vi.fn(() => `request-${send.mock.calls.length}`);
  const controller = createChallengeController(send);
  controller.update(view, 20, 1000, null, 1, undefined, true, 'keys');
  for (const key of challengeKeys('challenge')) controller.key(key);
  controller.update(view, 39, 1900, null, 1, undefined, true, 'keys');
  expect(send).not.toHaveBeenCalled();
  controller.update(view, 40, 2000, null, 1, undefined, true, 'keys');
  expect(send).toHaveBeenCalledTimes(1);
  const rejection = {
    requestId: 'request-1',
    type: 'EXIT_PROGRESS' as const,
    status: 'rejected' as const,
    code: 'NOT_READY',
  };
  controller.update(view, 40, 2100, null, 1, rejection, true, 'keys');
  controller.update(view, 50, 2600, null, 1, rejection, true, 'keys');
  expect(send).toHaveBeenCalledTimes(2);
  expect(controller.metrics().keys).toEqual({ attempts: 1, successes: 0 });
  controller.update(
    { ...base, self: { playerId: 'self', role: 'runner', status: 'ESCAPED' } },
    51,
    2650,
    null,
    1,
  );
  expect(controller.metrics().keys).toEqual({ attempts: 1, successes: 1 });
  controller.key(challengeKeys('challenge')[0]!);
  expect(controller.keyIndex).toBe(0);
});
it('discards completed keys if canceled or captured before the minimum time', () => {
  const base = viewFixture();
  if (base.self?.status !== 'ACTIVE') throw Error();
  const view = {
    ...base,
    self: {
      ...base.self,
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
  const send = vi.fn(() => 'id');
  const controller = createChallengeController(send);
  controller.update(view, 20, 1000, null, 1, undefined, true, 'keys');
  for (const key of challengeKeys('challenge')) controller.key(key);
  controller.suspend();
  controller.update(view, 40, 2000, null, 1, undefined, true, 'keys');
  expect(send).not.toHaveBeenCalled();
  controller.update(
    { ...base, self: { playerId: 'self', role: 'runner', status: 'CAPTURED' } },
    50,
    2500,
    null,
    1,
  );
  expect(controller.metrics().keys.successes).toBe(0);
});
