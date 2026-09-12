import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { roundFixture, viewFixture } from '../../room/product-fixture';
import { GameHud } from './GameHud';

it('keeps role, win condition, authoritative time and expired restraints readable together', () => {
  const self = viewFixture().self!;
  if (self.status !== 'ACTIVE') throw Error('active self required');
  const html = renderToStaticMarkup(
    createElement(GameHud, {
      round: roundFixture({ serverTick: 100, deadlineTick: 3600 }),
      self: { ...self, restraintUntilTick: 100 },
      mode: 'motion',
    }),
  );
  expect(html).toContain('02:55');
  expect(html).toContain('팀원 2명이 각자의 출구로 탈출하면 승리');
  expect(html).toContain('행동 가능');
  expect(html).not.toContain('구속 중');
  const practice = renderToStaticMarkup(
    createElement(GameHud, {
      round: roundFixture({ phase: 'TEAM_PRACTICE' }),
      self: { ...self, role: 'tagger', restraintUntilTick: 200 },
      mode: 'keyboard',
    }),
  );
  expect(practice).toContain('조작 연습');
  expect(practice).toContain('도망자 2명을 포획하거나 시간을 버티면 승리');
  expect(practice).toContain('구속 중');
});
