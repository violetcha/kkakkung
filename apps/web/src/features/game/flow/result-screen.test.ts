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

// S15P21C204-318. 데모 재경기는 관리자의 다음 역할을 고른다. "역할 바꿔"·인원 안내는 맞지 않는다.
// S15P21C204-396. 로비 복귀 재경기는 일반 방 기능이라 데모에서도 확인할 수 있게 둔다.
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
  expect(html).toContain('로비로 돌아가기');
  expect(html).not.toContain('/6명');
  expect(html).toMatch(/aria-pressed="true"[^>]*>도망자로 재경기/);
});

// S15P21C204-370. 누가 끊겼는지와, 그 사람을 다시 받으려면 방장이 무엇을 해야 하는지 알린다.
it('names the dropped player and tells the host how to take them back', () => {
  const round = roundFixture({
    phase: 'ABORTED',
    abortReason: 'GAME_CONNECTION_LOST',
    abortedBy: '둘',
    rematchState: 'available',
  });
  const host = renderToStaticMarkup(
    createElement(ResultScreen, {
      round,
      self: null,
      host: true,
      connectedCount: 5,
      onRematch() {},
    }),
  );
  expect(host).toContain('둘님의 연결이 끊겨 경기가 무효 처리되었습니다.');
  expect(host).toContain(
    '로비로 돌아가면 연결이 끊긴 참가자가 같은 방 코드로 다시 들어올 수 있습니다.',
  );
  const member = renderToStaticMarkup(
    createElement(ResultScreen, {
      round,
      self: null,
      host: false,
      connectedCount: 5,
      onRematch() {},
    }),
  );
  expect(member).toContain('방장이 로비로 돌아가면 연결이 끊긴 참가자가 다시 들어올 수 있습니다.');
  // 이름이 없으면 예전 문구 그대로다.
  const unnamed = renderToStaticMarkup(
    createElement(ResultScreen, {
      round: roundFixture({ phase: 'ABORTED', abortReason: 'GAME_CONNECTION_LOST' }),
      self: null,
      host: true,
      connectedCount: 5,
      onRematch() {},
    }),
  );
  expect(unnamed).toContain('게임 연결이 끊겨 경기가 무효 처리되었습니다.');
});
