import { expect, it } from 'vitest';
import { commandFeedback } from './command-feedback';
import { preparationFeedback } from './preparation-feedback';

it('gives a recovery action for preparation failures without showing unknown diagnostics', () => {
  expect(preparationFeedback('LAYOUT_UNAVAILABLE')).toContain('다시');
  expect(preparationFeedback('DEVICE_LOADING_TIMEOUT')).toContain('장치');
  expect(preparationFeedback(undefined)).toBeNull();
});
it('distinguishes pending, denied, and uncertain commands without disclosing raw errors', () => {
  const request = {
    requestId: 'x',
    type: 'INSTALL' as const,
    status: 'rejected' as const,
    code: 'private-path',
  };
  expect(commandFeedback(request)).toContain('설치');
  expect(commandFeedback(request)).not.toContain('private-path');
  expect(commandFeedback({ ...request, status: 'pending' })).toBeNull();
  expect(commandFeedback({ ...request, status: 'applied' })).toBeNull();
  expect(commandFeedback({ ...request, status: 'unconfirmed' })).toContain('현재 상태');
  expect(commandFeedback({ ...request, code: 'RATE_LIMITED' })).toContain('잠시');
  expect(commandFeedback({ ...request, type: 'EXCHANGE_ACCEPT' })).toContain('바로 옆');
  expect(commandFeedback({ ...request, type: 'REMATCH' })).toContain('방장');
});
