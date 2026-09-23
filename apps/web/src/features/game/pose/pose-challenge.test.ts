import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { PoseKind } from '../../input/InteractionRuntime';
import type { PoseMissReason } from './pose-evaluator';
import { viewFixture } from '../../room/product-fixture';
import { PoseChallenge } from './PoseChallenge';

function challengeView(poseKind: PoseKind = 'left'): PrivateView {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  return {
    ...view,
    self: {
      ...view.self,
      challenge: {
        challengeId: 'challenge',
        exitId: 'exit',
        poseKind,
        startedAtTick: 0,
        minSuccessTick: 40,
        expiresAtTick: 160,
      },
    },
  };
}

const render = (view: PrivateView = challengeView(), hint: PoseMissReason | null = null) =>
  renderToStaticMarkup(
    createElement(PoseChallenge, {
      view,
      tick: 60,
      progress: 0,
      hint,
      starting: false,
      send() {},
    }),
  );

it('states the arm framing rule for the whole challenge', () => {
  // S15P21C204-344. 팔이 프레임 밖이면 진행이 0 에 머무는데 진행 막대만으로는 알 수 없다.
  // 조건은 도전 내내 변하지 않으므로 계속 같은 자리에 적어 둔다.
  const html = render();
  expect(html).toContain('왼팔의 팔꿈치와 손목이 화면에 들어와야 인식됩니다');
  // 판정이 든 팔만 보므로 안내도 내린 팔을 요구하지 않는다.
  expect(html).toContain('반대쪽 팔은 내려도 됩니다');
  expect(html).toContain('물러나');
  expect(render(challengeView('right'))).toContain('오른팔의 팔꿈치와 손목');
  expect(render(challengeView('y'))).toContain('두 팔의 팔꿈치와 손목이 모두 화면에');
});

it('keeps the rule out of the pre-challenge panel', () => {
  // 아직 도전을 시작하지 않았으면 할 일은 출구를 향해 서는 것이다. 자세 조건은 그때 나온다.
  const view = challengeView();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  const before = render({ ...view, self: { ...view.self, challenge: null } });
  expect(before).not.toContain('화면에 들어와야 인식됩니다');
});

it('names the settled reason the pose is not standing', () => {
  // 순간 신호가 아니라 컨트롤러가 디바운스한 값만 여기 도착한다. 없으면 자리를 비운다.
  expect(render()).not.toContain('pose-hint');
  expect(render(challengeView(), 'arm-offscreen')).toContain(
    '왼팔의 팔꿈치나 손목이 화면 밖입니다',
  );
  expect(render(challengeView(), 'arm-low')).toContain('왼팔을 어깨 위로 더 올려 주세요');
  expect(render(challengeView(), 'other-arm')).toContain('오른팔은 내려 주세요');
  expect(render(challengeView('y'), 'arm-spread')).toContain('Y자를 만들어 주세요');
  expect(render(challengeView(), 'trunk')).toContain('얼굴과 양 어깨가 함께 보이게');
});
