import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SpectatorBar } from './SpectatorBar';

const spectating = {
  targetId: 'runner-a',
  cell: { x: 7, y: 8 },
  dir: 2 as const,
  action: null,
  candidates: ['runner-a', 'runner-b'],
};

it('names the watched player and offers every candidate', () => {
  const html = renderToStaticMarkup(
    createElement(SpectatorBar, {
      spectating,
      playerNames: { 'runner-a': '유리', 'runner-b': '초록' },
    }),
  );

  expect(html).toContain('유리');
  expect(html).toContain('시점');
  expect(html).toContain('data-spectate-target="runner-a"');
  expect(html).toContain('data-spectate-target="runner-b"');
});

it('marks the current target as pressed and refuses a second press on it', () => {
  const html = renderToStaticMarkup(
    createElement(SpectatorBar, {
      spectating,
      playerNames: { 'runner-a': '유리', 'runner-b': '초록' },
    }),
  );

  // 지금 보고 있는 대상은 눌린 상태이고 다시 누를 수 없다. 나머지는 눌러서 옮길 수 있다.
  expect(html).toMatch(/data-spectate-target="runner-a"[^>]*aria-pressed="true"/);
  expect(html).toMatch(/data-spectate-target="runner-a"[^>]*disabled/);
  expect(html).toMatch(/data-spectate-target="runner-b"[^>]*aria-pressed="false"/);
  expect(html).not.toMatch(/data-spectate-target="runner-b"[^>]*disabled/);
});

it('still tells the candidates apart when the roster has no names yet', () => {
  // S15P21C204-320. 로스터가 늦게 오면 이름이 없다. 그때 모두 같은 글자면 고를 수가 없다.
  const html = renderToStaticMarkup(createElement(SpectatorBar, { spectating }));

  expect(html).toMatch(/data-spectate-target="runner-a"[^>]*>도망자 1</);
  expect(html).toMatch(/data-spectate-target="runner-b"[^>]*>도망자 2</);
});
