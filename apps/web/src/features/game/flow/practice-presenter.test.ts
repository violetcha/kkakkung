import { expect, it } from 'vitest';
import { practicePresenter } from './practice-presenter';
import { INITIAL_DEVICES } from './device-readiness';
import { roundFixture, viewFixture } from '../../room/product-fixture';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PracticeScreen } from './PracticeScreen';
it('requires matching practice scope and actual device readiness, independent of time', () => {
  const round = roundFixture({ phase: 'TEAM_PRACTICE', serverTick: 100000 });
  const view = viewFixture({
    gameScope: { kind: 'practice', revision: 1, gameInstanceId: 'practice-team' },
  });
  expect(practicePresenter(round, view, INITIAL_DEVICES)?.canReady).toBe(false);
  expect(practicePresenter(round, viewFixture(), INITIAL_DEVICES)).toBeNull();
  expect(practicePresenter(roundFixture(), view, INITIAL_DEVICES)).toBeNull();
  expect(practicePresenter(round, { ...view, matchId: 'old' }, INITIAL_DEVICES)).toBeNull();
  expect(
    practicePresenter(round, view, {
      ...INITIAL_DEVICES,
      camera: 'ready',
      vision: 'ready',
      calibration: 'ready',
      audioPlayback: 'ready',
    })?.canReady,
  ).toBe(true);
});

it.each(['runner', 'tagger'] as const)(
  'only offers actions belonging to the %s practice role',
  (role) => {
    const view = viewFixture();
    const html = renderToStaticMarkup(
      createElement(PracticeScreen, {
        round: roundFixture({ phase: 'TEAM_PRACTICE' }),
        view: {
          ...view,
          self: { ...view.self!, role },
          gameScope: { kind: 'practice', revision: 1, gameInstanceId: 'practice-team' },
        },
        devices: INITIAL_DEVICES,
        readyReported: false,
        readSensors: () => null,
        onReady() {},
      }),
    );
    // S15P21C204-275. 조작 안내는 장치 점검이 맡고 연습방은 역할 행동만 남긴다.
    expect(html).not.toContain('W/S로 전진·후진');
    if (role === 'runner') {
      expect(html).toContain('아군과 지도를 교환');
      expect(html).toContain('출구에서 사용할 상체 포즈 연습');
      expect(html).not.toContain('1·2로 장비');
    } else {
      expect(html).toContain('1·2로 장비');
      expect(html).not.toContain('지도를 교환');
      expect(html).not.toContain('상체 포즈 연습');
      expect(html).not.toContain('연습 자세 유지');
    }
  },
);
