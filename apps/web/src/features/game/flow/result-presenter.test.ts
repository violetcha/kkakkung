import { expect, it } from 'vitest';
import { ABORT_REASONS } from '@kkakkung/protocol/game-schema';
import { roundFixture, viewFixture } from '../../room/product-fixture';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultScreen } from './ResultScreen';
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
  // 사유마다 다른 문구를 보여 준다. 관리자 종료(332)도 장애와 구분된다.
  expect(new Set(results.map((r) => r.message)).size).toBe(ABORT_REASONS.length);
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
  ['ESCAPED', 'two-captured', 'taggers', '탈출 성공', '패배'],
  ['ESCAPED', 'two-escaped', 'runners', '탈출 성공', '승리'],
  ['CAPTURED', 'two-escaped', 'runners', '포획됨', '승리'],
  ['CAPTURED', 'timeout', 'taggers', '포획됨', '패배'],
] as const)(
  'retains %s beside the final %s team result in the rendered screen',
  (status, reason, winner, personal, team) => {
    const round = roundFixture({ phase: 'RESULT', result: { reason, winner } });
    const self = { playerId: 'self', role: 'runner' as const, status };
    const html = renderToStaticMarkup(
      createElement(ResultScreen, { round, self, host: false, connectedCount: 6, onRematch() {} }),
    );
    expect(html).toContain(`나의 결과: ${personal}`);
    expect(html).toContain(`우리 팀 ${team}`);
    expect(html).toContain('종료 시 남은 도망자');
  },
);

it('does not invent a personal outcome for an active tagger or a player whose private view is missing', () => {
  const self = viewFixture().self!;
  const round = roundFixture({ phase: 'RESULT', result: { reason: 'timeout', winner: 'taggers' } });
  expect(resultPresenter(round, { ...self, role: 'tagger' })).toMatchObject({
    personalResult: null,
    teamResult: '우리 팀 승리',
  });
  expect(resultPresenter(round, null)).toMatchObject({ personalResult: null, teamResult: null });
});

it('preserves the pre-abort personal event without calling an invalidated match a win', () => {
  const result = resultPresenter(
    roundFixture({ phase: 'ABORTED', abortReason: 'MEDIA_UNAVAILABLE' }),
    { playerId: 'self', role: 'runner', status: 'ESCAPED' },
  );
  expect(result.personalResult).toBe('경기 중 기록: 탈출 · 경기는 무효 처리되었습니다.');
  expect(result.teamResult).toBeNull();
  expect(result.title).toBe('경기 무효');
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
