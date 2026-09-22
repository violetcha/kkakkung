import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { PoseChallenge } from './PoseChallenge';

function challengeView(): PrivateView {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  return {
    ...view,
    self: {
      ...view.self,
      challenge: {
        challengeId: 'challenge',
        exitId: 'exit',
        poseKind: 'left' as const,
        startedAtTick: 0,
        minSuccessTick: 40,
        expiresAtTick: 160,
      },
    },
  };
}

const render = (view: PrivateView = challengeView()) =>
  renderToStaticMarkup(
    createElement(PoseChallenge, {
      view,
      tick: 60,
      progress: 0,
      starting: false,
      send() {},
    }),
  );

it('states the arm framing rule for the whole challenge', () => {
  // S15P21C204-344. 팔이 프레임 밖이면 진행이 0 에 머무는데 진행 막대만으로는 알 수 없다.
  // 조건은 도전 내내 변하지 않으므로 계속 같은 자리에 적어 둔다.
  const html = render();
  expect(html).toContain('양팔이 모두 화면에 들어와야 인식됩니다');
  expect(html).toContain('한쪽 팔만 드는 자세도 마찬가지입니다');
  expect(html).toContain('물러나');
  expect(html).toContain('두 팔이 카메라에 들어오게');
});

it('keeps the rule out of the pre-challenge panel', () => {
  // 아직 도전을 시작하지 않았으면 할 일은 출구를 향해 서는 것이다. 자세 조건은 그때 나온다.
  const view = challengeView();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  const before = render({ ...view, self: { ...view.self, challenge: null } });
  expect(before).not.toContain('양팔이 모두 화면에 들어와야 인식됩니다');
});
