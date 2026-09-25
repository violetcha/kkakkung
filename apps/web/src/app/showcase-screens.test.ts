/**
 * 발표 시연 방 화면. 진입 페이지는 역할만 고르고, 로비는 방이 알려 준 자리 수(4)로 그리며 맵은
 * 16x16 으로 잠긴 채 보이고, 결과 화면에는 재경기 단추가 없다.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ShowcaseApp, showcaseEntryMessage } from './ShowcaseApp';
import { LobbyScreen } from '../features/room/LobbyScreen';
import { ConnectionLostScreen } from '../features/game/flow/ConnectionLostScreen';
import { ResultScreen } from '../features/game/flow/ResultScreen';
import { resultPresenter } from '../features/game/flow/result-presenter';
import { roundFixture } from '../features/room/product-fixture';

const roster = {
  matchId: 'm',
  stateVersion: 1,
  phase: 'LOBBY' as const,
  hostId: 'host',
  kind: 'showcase' as const,
  capacity: 4,
  players: ['host', 'friend'].map((playerId) => ({
    playerId,
    nickname: playerId,
    connected: true,
    ready: false,
  })),
};

it('renders the showcase entry with a role choice and no room code or credential field', () => {
  const html = renderToStaticMarkup(createElement(ShowcaseApp));
  expect(html).toContain('시연 방 입장');
  expect(html).toContain('도망자');
  expect(html).toContain('술래');
  expect(html).toContain('16x16');
  expect(html).not.toContain('방 코드');
  expect(html).not.toContain('OPS_TOKEN');
});

it('draws four seats and a locked 16x16 map for a showcase lobby, even for the host', () => {
  const html = renderToStaticMarkup(
    createElement(LobbyScreen, {
      roster,
      selfId: 'host',
      roomCode: 'ABCDEF',
      mapSize: 'large',
      canChooseMapSize: true,
      onSelectMapSize() {},
    }),
  );
  expect(html).toContain('2/4');
  expect(html.match(/빈 자리/g)).toHaveLength(2);
  expect(html).toContain('시연 참가자를 기다리는 중');
  // 서버가 준 크기가 아니라 시연 고정값이 눌려 있고, 세 단추 모두 잠겨 있다.
  expect(html).toContain('16x16');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html.indexOf('aria-pressed="true"')).toBeLessThan(html.indexOf('24x24'));
  expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  expect(html).toContain('시연 맵은 16x16으로 고정되어 있습니다.');
  expect(html).not.toContain('장치 점검이 시작되면');
});

it('keeps six seats for an ordinary roster that carries no capacity', () => {
  const ordinary = { ...roster, kind: undefined, capacity: undefined };
  const html = renderToStaticMarkup(
    createElement(LobbyScreen, { roster: ordinary, selfId: 'friend', roomCode: 'ABCDEF' }),
  );
  expect(html).toContain('2/6');
  expect(html.match(/빈 자리/g)).toHaveLength(4);
});

// S15P21C204-390. 시연 방도 같은 자리로 다시 할 수 있다. 역할 바꾸기는 없다.
it('offers a showcase host a same-seat restart and the lobby, without a role swap or a six-player prompt', () => {
  const html = renderToStaticMarkup(
    createElement(ResultScreen, {
      round: roundFixture({
        phase: 'RESULT',
        rematchState: 'available',
        result: { reason: 'timeout', winner: 'runners' },
        counts: { escaped: 2, captured: 0 },
      }),
      self: { playerId: 'self', role: 'runner', status: 'ESCAPED' },
      host: true,
      connectedCount: 4,
      onRematch() {},
      showcase: true,
      capacity: 4,
    }),
  );
  expect(html).toContain('도망자 승리');
  expect(html).toContain('탈출이 포획보다 많아');
  expect(html).toContain('같은 자리로 다시 시작');
  expect(html).toContain('로비로 돌아가기');
  expect(html).not.toContain('역할 바꿔');
  expect(html).not.toContain('/6명');
  // 도망자 둘 중 둘이 탈출했으니 남은 도망자는 0 이다.
  expect(html).toContain('종료 시 남은 도망자 0');
});

it('counts remaining runners from the room size and keeps the ordinary timeout wording for taggers', () => {
  const runnersWin = resultPresenter(
    roundFixture({ phase: 'RESULT', result: { reason: 'timeout', winner: 'runners' } }),
    null,
    { runners: 2 },
  );
  expect(runnersWin.message).toContain('도망자 팀이 승리');
  const taggersWin = resultPresenter(
    roundFixture({
      phase: 'RESULT',
      result: { reason: 'timeout', winner: 'taggers' },
      counts: { escaped: 1, captured: 0 },
    }),
    null,
    { runners: 2 },
  );
  expect(taggersWin.message).toBe('제한 시간이 끝나 술래 팀이 승리했습니다.');
  expect(taggersWin.counts.active).toBe(1);
  expect(resultPresenter(roundFixture(), null).counts.active).toBe(3);
});

it('S15P21C204-363: tells a showcase member the host closed the room and points back to /showcase', () => {
  const closed = renderToStaticMarkup(
    createElement(ConnectionLostScreen, { onLeave() {}, showcaseClosed: true, showcase: true }),
  );
  expect(closed).toContain('시연이 종료되었습니다');
  expect(closed).toContain('시연 입장 화면으로');
  expect(closed).not.toContain('입장 화면에서 새 방을');
  // 일반 방의 문구는 그대로다.
  const removed = renderToStaticMarkup(
    createElement(ConnectionLostScreen, { onLeave() {}, removed: true }),
  );
  expect(removed).toContain('방장이 대기방에서 내보냈습니다');
  expect(removed).toContain('>입장 화면으로<');
});

it('S15P21C204-370: tells a dropped player the room code to come back with', () => {
  const lost = renderToStaticMarkup(
    createElement(ConnectionLostScreen, { onLeave() {}, roomCode: 'ABCDEF' }),
  );
  expect(lost).toContain('방장이 로비로 돌아가면 방 코드 ABCDEF로 다시 참가할 수 있습니다.');
  const unknown = renderToStaticMarkup(createElement(ConnectionLostScreen, { onLeave() {} }));
  expect(unknown).toContain('입장 화면에서 다시 참가해 주세요.');
  const showcase = renderToStaticMarkup(
    createElement(ConnectionLostScreen, { onLeave() {}, showcase: true, roomCode: 'ABCDEF' }),
  );
  expect(showcase).not.toContain('ABCDEF');
});

it('S15P21C204-362: tells a member the server is not admitting instead of blaming a full room', () => {
  expect(showcaseEntryMessage(new Error('SHOWCASE_REQUEST_FAILED:503:ADMISSION_CLOSED'))).toBe(
    '지금은 입장을 받고 있지 않습니다. 서버가 준비되면 다시 시도해 주세요.',
  );
  // 코드가 없는 503 과 다른 코드는 전과 같은 문구다.
  expect(showcaseEntryMessage(new Error('SHOWCASE_REQUEST_FAILED:503'))).toContain('가득 찼거나');
  expect(showcaseEntryMessage(new Error('SHOWCASE_REQUEST_FAILED:503:CAPACITY'))).toContain(
    '가득 찼거나',
  );
  expect(showcaseEntryMessage(new Error('SHOWCASE_REQUEST_FAILED:409:ROLE_FULL'))).toContain(
    '다른 역할',
  );
  expect(showcaseEntryMessage(new Error('CONNECTION_FAILED'))).toContain('네트워크');
});
