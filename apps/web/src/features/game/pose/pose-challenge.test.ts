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

const render = (
  view: PrivateView = challengeView(),
  hint: PoseMissReason | null = null,
  progress = 0,
) =>
  renderToStaticMarkup(
    createElement(PoseChallenge, {
      view,
      tick: 60,
      progress,
      hint,
      starting: false,
      send() {},
    }),
  );

it('shows the pose as a figure with one short cue instead of long sentences', () => {
  // 도전 중인 사람은 팔을 든 채라 긴 문장을 읽지 못한다. 그림이 할 일을, 한 줄이 지금 할 동작을 말한다.
  const html = render(challengeView('y'));
  expect(html).toContain('pose-figure');
  expect(html).toContain('그림처럼 팔을 드세요');
  // 늘 떠 있던 팔 프레이밍 문장은 화면에서 뺐다(화면 낭독용 문장은 남는다).
  expect(html).not.toContain('화면에 들어와야 인식됩니다');
  expect(render(challengeView('y'), null, 0.5)).toContain('그대로 유지!');
  expect(render(challengeView('y'), null, 1)).toContain('data-state="held"');
});

it('keeps the pose guide out of the pre-challenge panel', () => {
  // 아직 도전을 시작하지 않았으면 할 일은 출구를 향해 서는 것이다. 자세 그림은 그때 나온다.
  const view = challengeView();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  const before = render({ ...view, self: { ...view.self, challenge: null } });
  expect(before).not.toContain('pose-figure');
  expect(before).toContain('출구 벽을 마주 보고 E');
});

it('turns the settled reason into a short cue and points at the arm', () => {
  // 순간 신호가 아니라 컨트롤러가 디바운스한 값만 여기 도착한다. 없으면 경고 표시도 없다.
  expect(render()).not.toContain('data-miss');
  expect(render()).not.toContain('pose-figure-arrow');
  expect(render(challengeView(), 'arm-offscreen')).toContain('한 걸음 뒤로');
  expect(render(challengeView(), 'arm-low')).toContain('팔을 더 높이');
  expect(render(challengeView(), 'other-arm')).toContain('반대 팔은 내리기');
  expect(render(challengeView('y'), 'arm-spread')).toContain('팔을 더 벌리기');
  expect(render(challengeView(), 'trunk')).toContain('얼굴·어깨가 보이게');
  // 어느 팔인지는 그림의 화살표가 짚는다. 한 팔 자세의 팔이 낮으면 든 팔 하나만 짚는다.
  expect(render(challengeView('left'), 'arm-low').match(/pose-figure-arrow/g)).toHaveLength(1);
  expect(render(challengeView('y'), 'arm-low').match(/pose-figure-arrow/g)).toHaveLength(2);
  // 화면 낭독기는 그림을 못 보므로 긴 원인 문장을 그대로 받는다.
  expect(render(challengeView(), 'arm-low')).toContain('왼팔을 어깨 위로 더 올려 주세요');
  expect(render(challengeView(), 'other-arm')).toContain('오른팔은 내려 주세요');
});
