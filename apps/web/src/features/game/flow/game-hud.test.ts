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

it('marks escape, capture and the self state with shape and data attributes, not colour alone', () => {
  const self = viewFixture().self!;
  if (self.status !== 'ACTIVE') throw Error('active self required');
  const render = (restraintUntilTick: number | null) =>
    renderToStaticMarkup(
      createElement(GameHud, {
        round: roundFixture({ serverTick: 100, counts: { escaped: 1, captured: 2 } }),
        self: { ...self, restraintUntilTick },
        mode: 'keyboard',
      }),
    );
  const ready = render(null);
  expect(ready).toMatch(/data-outcome="escape"[^>]*>[^<]*◇[^<]*탈출 1\/2/);
  expect(ready).toMatch(/data-outcome="capture"[^>]*>[^<]*◆[^<]*포획 2\/2/);
  expect(ready).toContain('data-state="ready"');
  const restrained = render(200);
  expect(restrained).toContain('data-state="restrained"');
  expect(restrained).toContain('구속 중');
});

it('does not present a clock when the demo round has no deadline', () => {
  const self = viewFixture().self!;
  const html = renderToStaticMarkup(
    createElement(GameHud, {
      round: roundFixture({ deadlineTick: null }),
      self,
      mode: 'keyboard',
    }),
  );
  expect(html).toContain('데모 진행');
  expect(html).not.toContain('시간 확인 중');
});

// S15P21C204-342. 데모 라운드는 시간 초과로 끝나지 않는다(316). "시간을 버티면 승리" 는 거짓이다.
it('tells a tagger there is no clock to outlast in a demo round', () => {
  const self = viewFixture().self!;
  const tagger = { ...self, role: 'tagger' as const };
  const demo = renderToStaticMarkup(
    createElement(GameHud, { round: roundFixture({ deadlineTick: null }), self: tagger }),
  );
  expect(demo).toContain('도망자 2명을 포획하면 승리 · 제한시간 없음');

  const ordinary = renderToStaticMarkup(
    createElement(GameHud, { round: roundFixture({ deadlineTick: 3600 }), self: tagger }),
  );
  expect(ordinary).toContain('시간을 버티면 승리');
});
