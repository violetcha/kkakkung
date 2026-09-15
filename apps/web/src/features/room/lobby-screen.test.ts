import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LobbyScreen } from './LobbyScreen';
import { PRIVACY_NOTICE } from './privacy-notice';
import { ConnectionLostScreen } from '../game/flow/ConnectionLostScreen';

const roster = {
  matchId: 'm',
  stateVersion: 1,
  phase: 'LOBBY' as const,
  hostId: 'host',
  players: ['host', 'friend'].map((playerId) => ({
    playerId,
    nickname: playerId,
    connected: true,
    ready: false,
  })),
};
it('offers controls only to the host and disables them until authoritative access arrives', () => {
  const render = (
    selfId: string,
    access?: { matchId: string; revision: number; locked: boolean },
  ) =>
    renderToStaticMarkup(
      createElement(LobbyScreen, {
        roster,
        selfId,
        roomCode: 'ABCDEF',
        access,
        onLock() {},
        onKick() {},
      }),
    );
  expect(render('friend')).not.toContain('<button');
  expect(render('host').match(/disabled=""/g)).toHaveLength(2);
  const html = render('host', { matchId: 'm', revision: 1, locked: true });
  expect(html).toContain('입장 잠금 해제');
  expect(html).toContain('friend 내보내기');
  expect(html).not.toContain('host 내보내기');
  expect(html).not.toContain('disabled');
});
it('explains host removal separately from room expiry and keeps a return action', () => {
  const html = renderToStaticMarkup(
    createElement(ConnectionLostScreen, { removed: true, onLeave() {} }),
  );
  expect(html).toContain('방장이 대기방에서 내보냈습니다');
  expect(html).toContain('입장 화면으로');
  expect(html).not.toContain('대기 시간이 끝났습니다');
});
it('shows every privacy notice sentence before devices are turned on', () => {
  const html = renderToStaticMarkup(
    createElement(LobbyScreen, { roster, selfId: 'friend', roomCode: 'ABCDEF' }),
  );
  expect(PRIVACY_NOTICE.length).toBeGreaterThanOrEqual(4);
  for (const sentence of PRIVACY_NOTICE) expect(html).toContain(sentence.text);
  expect(html).toContain('개인정보 처리 안내');
  expect(html).not.toContain('녹화 기능을 제공하지 않습니다');
});
it('never describes the processed face as anonymised', () => {
  const html = renderToStaticMarkup(
    createElement(LobbyScreen, { roster, selfId: 'friend', roomCode: 'ABCDEF' }),
  );
  expect(html).not.toContain('익명');
  for (const sentence of PRIVACY_NOTICE) {
    expect(sentence.text).not.toContain('익명');
    expect(sentence.evidence.length).toBeGreaterThan(0);
  }
});
