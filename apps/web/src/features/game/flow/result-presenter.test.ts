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
