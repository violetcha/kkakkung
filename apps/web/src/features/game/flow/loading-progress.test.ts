import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { roundFixture } from '../../room/product-fixture';
import { LoadingOverlay } from './LoadingOverlay';
import { loadingProgress } from './loading-progress';

const states = (phase: 'MAP_FINALIZING' | 'GAME_LOADING' | 'COUNTDOWN') =>
  loadingProgress({ round: roundFixture({ phase }), serverNow: null })!.steps.map(
    (step) => step.state,
  );

describe('loadingProgress', () => {
  it('walks one progress line from maze to connection to start', () => {
    expect(states('MAP_FINALIZING')).toEqual(['busy', 'waiting', 'waiting']);
    expect(states('GAME_LOADING')).toEqual(['done', 'busy', 'waiting']);
    expect(states('COUNTDOWN')).toEqual(['done', 'done', 'busy']);
  });

  it('is absent outside the phases that wait for a start', () => {
    for (const phase of ['LOBBY', 'DEVICE_CHECK', 'TEAM_PRACTICE', 'PLAYING', 'RESULT'] as const)
      expect(loadingProgress({ round: roundFixture({ phase }), serverNow: null })).toBeNull();
  });

  it('counts down only in the start step and reports the wait for the server at zero', () => {
    const countdown = (startAt: number, serverNow: number) =>
      loadingProgress({ round: roundFixture({ phase: 'COUNTDOWN', startAt }), serverNow })
        ?.countdown;
    expect(countdown(4000, 1000)).toBe(3);
    expect(countdown(1000, 4000)).toBe(0);
    expect(
      loadingProgress({ round: roundFixture({ phase: 'GAME_LOADING' }), serverNow: 1000 })
        ?.countdown,
    ).toBeNull();
  });

  it('shows my waiting items only while the connection step is running', () => {
    const pending = ['카메라 연결'];
    expect(
      loadingProgress({ round: roundFixture({ phase: 'GAME_LOADING' }), serverNow: null, pending })
        ?.pending,
    ).toEqual(pending);
    expect(
      loadingProgress({ round: roundFixture({ phase: 'COUNTDOWN' }), serverNow: null, pending })
        ?.pending,
    ).toEqual([]);
  });

  it('carries the preparation failure guidance so it stays on the same screen', () => {
    const notice = loadingProgress({
      round: roundFixture({ phase: 'GAME_LOADING', preparationIssue: 'DEVICE_LOADING_TIMEOUT' }),
      serverNow: null,
    })?.notice;
    expect(notice).toContain('장치와 네트워크를 확인');
    expect(
      loadingProgress({ round: roundFixture({ phase: 'GAME_LOADING' }), serverNow: null })?.notice,
    ).toBeNull();
  });
});

describe('LoadingOverlay', () => {
  const render = (round: Parameters<typeof LoadingOverlay>[0]['round'], props = {}) =>
    renderToStaticMarkup(createElement(LoadingOverlay, { round, serverNow: null, ...props }));

  it('shows every step of the one waiting screen and marks the current one', () => {
    const html = render(roundFixture({ phase: 'GAME_LOADING' }));
    for (const label of ['미로 준비', '화면·연결 확인', '시작']) expect(html).toContain(label);
    expect(html).toContain('aria-label="준비 진행"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain('aria-current="true"');
  });

  it('keeps my waiting items and the blocked stage text', () => {
    const html = render(roundFixture({ phase: 'GAME_LOADING' }), {
      pending: ['카메라 연결(권한 확인 중 12초)'],
    });
    expect(html).toContain('내 준비 대기: 카메라 연결(권한 확인 중 12초)');
  });

  it('keeps the timeout recovery guidance on the same screen instead of the automatic start line', () => {
    const html = render(
      roundFixture({ phase: 'GAME_LOADING', preparationIssue: 'DEVICE_LOADING_TIMEOUT' }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('장치와 네트워크를 확인');
    expect(html).not.toContain('준비가 끝나면 자동으로 시작합니다');
  });

  it('draws the countdown number in the start step', () => {
    const html = render(roundFixture({ phase: 'COUNTDOWN', startAt: 3000 }), { serverNow: 1000 });
    expect(html).toContain('class="countdown"');
    expect(html).toContain('>2<');
  });
});
