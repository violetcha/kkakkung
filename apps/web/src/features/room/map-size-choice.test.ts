import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MapSizeChoice } from './MapSizeChoice';
import { LobbyScreen } from './LobbyScreen';
import { MAP_SIZE_OPTIONS, DEFAULT_MAP_SIZE } from './map-size';

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

it('offers the three sizes with the real odd grid beside the label', () => {
  const html = renderToStaticMarkup(
    createElement(MapSizeChoice, { value: 'large', canEdit: true, onSelect() {} }),
  );
  expect(MAP_SIZE_OPTIONS).toHaveLength(3);
  for (const option of MAP_SIZE_OPTIONS) {
    expect(html).toContain(option.label);
    expect(html).toContain(`${option.grid}×${option.grid} 미로`);
    // 미로는 홀수 격자 위에만 만들어진다. 표기 숫자를 격자로 쓰지 않는다.
    expect(option.grid % 2).toBe(1);
    expect(String(option.grid)).not.toBe(option.label.split('x')[0]);
  }
});

it('marks only the chosen size as pressed', () => {
  const html = renderToStaticMarkup(
    createElement(MapSizeChoice, { value: 'medium', canEdit: true, onSelect() {} }),
  );
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
});

it('lets nobody but an editing host press a size', () => {
  const render = (canEdit: boolean, onSelect?: () => void) =>
    renderToStaticMarkup(
      createElement(MapSizeChoice, { value: DEFAULT_MAP_SIZE, canEdit, onSelect }),
    );
  // 방장이고 바꿀 수 있는 단계일 때만 눌린다.
  expect(render(true, () => {})).not.toContain('disabled');
  // 참가자.
  expect(render(false, () => {}).match(/disabled=""/g)).toHaveLength(3);
  // 방장이라도 바꾸는 경로가 없으면 누를 수 없다.
  expect(render(true).match(/disabled=""/g)).toHaveLength(3);
});

it('says who chooses and until when', () => {
  const editing = renderToStaticMarkup(
    createElement(MapSizeChoice, { value: 'large', canEdit: true, onSelect() {} }),
  );
  expect(editing).toContain('장치 점검이 시작되면 바꿀 수 없습니다');
  const watching = renderToStaticMarkup(
    createElement(MapSizeChoice, { value: 'large', canEdit: false }),
  );
  expect(watching).toContain('방장이 고른 맵입니다');
  expect(watching).not.toContain('장치 점검이 시작되면');
});

it('shows the chosen map to participants above the seats without letting them change it', () => {
  const html = renderToStaticMarkup(
    createElement(LobbyScreen, {
      roster,
      selfId: 'friend',
      roomCode: 'ABCDEF',
      mapSize: 'small',
      canChooseMapSize: true,
      onSelectMapSize() {},
    }),
  );
  expect(html).toContain('맵 크기');
  expect(html).toContain('방장이 고른 맵입니다');
  expect(html.match(/disabled=""/g)).toHaveLength(3);
  // 자리 목록보다 위에 있다.
  expect(html.indexOf('맵 크기')).toBeLessThan(html.indexOf('빈 자리'));
});

it('locks the choice for the host once the lobby phase is over', () => {
  const render = (canChooseMapSize: boolean) =>
    renderToStaticMarkup(
      createElement(LobbyScreen, {
        roster,
        selfId: 'host',
        roomCode: 'ABCDEF',
        mapSize: 'large',
        canChooseMapSize,
        onSelectMapSize() {},
      }),
    );
  expect(render(true)).toContain('장치 점검이 시작되면 바꿀 수 없습니다');
  expect(render(false)).toContain('방장이 고른 맵입니다');
});
