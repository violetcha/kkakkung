import { expect, it } from 'vitest';
import { commandFeedback } from './command-feedback';
import { preparationFeedback } from './preparation-feedback';

it('gives a recovery action for preparation failures without showing unknown diagnostics', () => {
  expect(preparationFeedback('LAYOUT_UNAVAILABLE')).toContain('다시');
  expect(preparationFeedback('DEVICE_LOADING_TIMEOUT')).toContain('장치');
  expect(preparationFeedback(undefined)).toBeNull();
});
// S15P21C204-364. 월 사용량 한도는 다시 준비해도 풀리지 않는다. 재시도를 권하지 말고 이유를 말한다.
it('explains the monthly media limit without telling players to retry', () => {
  const text = preparationFeedback('MEDIA_BUDGET_EXHAUSTED');
  expect(text).toContain('사용량');
  expect(text).toContain('진행 중인 경기는 영향이 없습니다');
  expect(text).not.toContain('다시 준비');
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
it('keeps movement commands silent so the status line does not flicker on every input', () => {
  const move = {
    requestId: 'm',
    type: 'MOVE_INTENT' as const,
    status: 'waiting-view' as const,
    code: null,
  };
  expect(commandFeedback(move)).toBeNull();
  expect(commandFeedback({ ...move, status: 'unconfirmed', code: 'UNCONFIRMED' })).toBeNull();
  expect(
    commandFeedback({ ...move, type: 'TURN', status: 'rejected', code: 'RATE_LIMITED' }),
  ).toBeNull();
  expect(commandFeedback({ ...move, type: 'INSTALL' })).toContain('갱신된 화면');
});
