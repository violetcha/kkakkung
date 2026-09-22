import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { roundFixture } from '../../room/product-fixture';
import { ResultScreen } from './ResultScreen';

it('shows personal completion without rematch or connection-cleanup prompts before the round ends', () => {
  const html = renderToStaticMarkup(
    createElement(ResultScreen, {
      round: roundFixture(),
      self: { playerId: 'self', role: 'runner', status: 'ESCAPED' },
      host: true,
      connectedCount: 6,
      onRematch() {},
    }),
  );
  expect(html).toContain('탈출 성공');
  expect(html).not.toContain('<button');
  expect(html).not.toContain('연결을 정리');
});
it('holds all rematch controls while an accepted request waits for room transition', () => {
  const html = renderToStaticMarkup(
    createElement(ResultScreen, {
      round: roundFixture({
        phase: 'ABORTED',
        abortReason: 'GAME_CONNECTION_LOST',
        rematchState: 'requested',
      }),
      self: null,
      host: true,
      connectedCount: 5,
      onRematch() {},
    }),
  );
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  expect(html).toContain('현재 5/6명');
  expect(html).toContain('잠시 기다려');
});
it('keeps recovery controls available after a rejected rematch', () => {
  const html = renderToStaticMarkup(
    createElement(ResultScreen, {
      round: roundFixture({ phase: 'RESULT', rematchState: 'available' }),
      self: null,
      host: true,
      connectedCount: 6,
      onRematch() {},
      request: { requestId: 'x', type: 'REMATCH', status: 'rejected', code: 'NOT_ALLOWED' },
    }),
  );
  expect(html).not.toContain('disabled');
  expect(html).toContain('재경기를 시작하지 못했습니다');
});

// S15P21C204-318. 데모 재경기는 관리자의 다음 역할을 고른다. "역할 바꿔"·로비·인원 안내는 맞지 않는다.
it('offers the operator a role for the next demo round instead of team modes', () => {
  const element = createElement(ResultScreen, {
    round: roundFixture({ phase: 'RESULT', rematchState: 'available' }),
    self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
    host: true,
    connectedCount: 1,
    demo: true,
    onRematch() {},
  });
  const html = renderToStaticMarkup(element);
  expect(html).toContain('도망자로 재경기');
  expect(html).toContain('술래로 재경기');
  expect(html).not.toContain('역할 바꿔 재경기');
  expect(html).not.toContain('로비로 돌아가기');
  expect(html).not.toContain('/6명');
  expect(html).toMatch(/aria-pressed="true"[^>]*>도망자로 재경기/);
});
