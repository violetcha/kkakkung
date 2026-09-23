import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CamcorderOverlay, formatRecordingTime, GameStatusChrome } from './CamcorderOverlay';

describe('formatRecordingTime', () => {
  it('keeps a fixed hours, minutes and seconds camcorder readout', () => {
    expect(formatRecordingTime(4)).toBe('00:00:04');
    expect(formatRecordingTime(3_661)).toBe('01:01:01');
    expect(formatRecordingTime(-1)).toBe('00:00:00');
  });
});

it('keeps authoritative status in an accessibility-only layer behind the camera chrome', () => {
  const html = renderToStaticMarkup(
    createElement(GameStatusChrome, {
      startedAtMs: 1_000,
      nowMs: 5_000,
      status: createElement('p', null, '남은 시간 02:55'),
    }),
  );

  expect(html).toContain('class="camcorder-overlay"');
  expect(html).toContain('class="game-status-a11y"');
  expect(html).toContain('남은 시간 02:55');
  expect(html).not.toContain('event-log');
});

it('exposes the recording state while keeping four frame corners decorative', () => {
  const html = renderToStaticMarkup(
    createElement(CamcorderOverlay, { startedAtMs: 1_000, nowMs: 5_000 }),
  );

  expect(html).toContain('class="camcorder-overlay"');
  expect(html).toContain('aria-label="녹화 중 00:00:04"');
  expect(html).toContain('class="camcorder-rec-dot"');
  expect(html.match(/camcorder-corner/g)).toHaveLength(4);
});

// S15P21C204-342. 제한시간 없는 데모 라운드는 남은 시간이 null 이다. 전에는 00:00:00 에 멈춘 채
// "남은 시간" 으로 읽혀, 시간이 흐르지 않는 것처럼 보였다.
it('counts elapsed time when the round has no deadline', () => {
  const html = renderToStaticMarkup(
    createElement(GameStatusChrome, {
      remainingSeconds: null,
      startedAtMs: 1_000,
      nowMs: 125_000,
      status: null,
    }),
  );
  expect(html).toContain('00:02:04');
  expect(html).toContain('지난 시간');
  expect(html).not.toContain('남은 시간');
});

it('still counts down when the round has a deadline', () => {
  const html = renderToStaticMarkup(
    createElement(GameStatusChrome, { remainingSeconds: 95, status: null }),
  );
  expect(html).toContain('01:35');
  expect(html).toContain('남은 시간');
});

// S15P21C204-369. 시연 방 녹화 화면의 시점 표시. 시계 아래에 역할 · 이름, 관전 중에는 관전 · 대상.
it('captions a showcase viewpoint with the role and name in the role colour, and nothing without a caption', () => {
  const runner = renderToStaticMarkup(
    createElement(GameStatusChrome, {
      remainingSeconds: 95,
      status: null,
      caption: { kind: 'role', role: 'runner', name: '주여니' },
    }),
  );
  expect(runner).toContain('class="stage-caption"');
  expect(runner).toContain('data-role="runner"');
  expect(runner).toContain('도망자 · 주여니');

  const tagger = renderToStaticMarkup(
    createElement(GameStatusChrome, {
      remainingSeconds: 95,
      role: 'tagger',
      status: null,
      caption: { kind: 'role', role: 'tagger', name: '산이' },
    }),
  );
  expect(tagger).toContain('data-role="tagger"');
  expect(tagger).toContain('술래 · 산이');

  const spectate = renderToStaticMarkup(
    createElement(GameStatusChrome, {
      remainingSeconds: 40,
      status: null,
      caption: { kind: 'spectate', name: '유림' },
    }),
  );
  expect(spectate).toContain('data-role="spectate"');
  expect(spectate).toContain('관전 · 유림');

  // 일반 방은 caption 을 넘기지 않으므로 아무것도 그리지 않는다.
  const plain = renderToStaticMarkup(
    createElement(GameStatusChrome, { remainingSeconds: 95, status: null, caption: null }),
  );
  expect(plain).not.toContain('stage-caption');
});
