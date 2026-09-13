import { expect, it } from 'vitest';
import { ABORT_REASONS } from '@kkakkung/protocol/game-schema';
import { roundFixture } from '../../room/product-fixture';
import { resultPresenter } from './result-presenter';
it('shows personal results and public counts without survivor detail', () => {
  const result = resultPresenter(roundFixture({ counts: { escaped: 1, captured: 1 } }), {
    playerId: 'self',
    role: 'runner',
    status: 'ESCAPED',
  });
  expect(result.title).toBe('탈출 성공');
  expect(result.counts.active).toBe(1);
  expect(result).not.toHaveProperty('visibleEntities');
});
it('distinguishes each abort cause from a loss', () => {
  const results = ABORT_REASONS.map((reason) =>
    resultPresenter(roundFixture({ phase: 'ABORTED', abortReason: reason }), null),
  );
  expect(new Set(results.map((r) => r.message)).size).toBe(4);
  expect(results.every((r) => r.title === '경기 무효')).toBe(true);
});

it('ends preparation failures without suggesting the aborted match is still awaiting a result', () => {
  const result = resultPresenter(
    roundFixture({ phase: 'ABORTED', abortReason: null, result: null }),
    null,
  );
  expect(result.title).toBe('경기 무효');
  expect(result.message).toContain('방장이 다시 시작');
  expect(result.message).not.toContain('확인하고 있습니다');
  expect(result.remaining).toBeNull();
});

it.each([
  ['two-escaped', 'runners', '탈출'],
  ['two-captured', 'taggers', '포획'],
  ['timeout', 'taggers', '제한 시간'],
] as const)('explains final %s without a live countdown', (reason, winner, label) => {
  const result = resultPresenter(
    roundFixture({ phase: 'RESULT', result: { reason, winner } }),
    null,
  );
  expect(result.message).toContain(label);
  expect(result.message).toContain('승리');
  expect(result.remaining).toBeNull();
});
