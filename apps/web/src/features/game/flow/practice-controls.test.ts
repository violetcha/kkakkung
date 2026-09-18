import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { LocalControls } from './LocalControls';
import { PracticeScreen } from './PracticeScreen';
import { INITIAL_DEVICES, deviceLost } from './device-readiness';
import { roundFixture, viewFixture } from '../../room/product-fixture';

const READY = {
  ...INITIAL_DEVICES,
  camera: 'ready',
  vision: 'ready',
  calibration: 'ready',
  audioPlayback: 'ready',
} as const;

/** 장치 점검 화면이 이미 보여 준 것들. 연습방에 다시 나오면 안 된다. */
const DEVICE_CHECK_REPEATS = [
  '키보드로 조작',
  '보정 후 모션으로 조작',
  '마이크 연결·재시도',
  '마이크 끄기',
  '조작 안내 · 장치 설정',
  '고개를 좌우로 돌리면',
  'W/S 또는 ↑/↓',
  '자세를 맞춘 뒤 보정해',
] as const;

const controls = (
  status: DeviceStatus,
  variant: 'full' | 'quiet',
  mode: 'motion' | 'keyboard' = 'motion',
) =>
  renderToStaticMarkup(
    createElement(LocalControls, {
      status,
      mode,
      previewHost() {},
      onKeyboard() {},
      onMotion: async () => {},
      onRecover: async () => {},
      onMicrophone: async () => {},
      variant,
    }),
  );

describe('deviceLost', () => {
  it('is true only when tracking devices dropped, never for an optional microphone', () => {
    expect(deviceLost(READY)).toBe(false);
    expect(deviceLost({ ...READY, microphone: 'denied' })).toBe(false);
    expect(deviceLost({ ...READY, microphone: 'failed' })).toBe(false);
    expect(deviceLost({ ...READY, camera: 'failed' })).toBe(true);
    expect(deviceLost({ ...READY, vision: 'failed' })).toBe(true);
    expect(deviceLost({ ...READY, calibration: 'failed' })).toBe(true);
    expect(deviceLost(INITIAL_DEVICES)).toBe(true);
  });
});

describe('LocalControls in the practice room', () => {
  it('drops every control and guidance the device check already showed', () => {
    const quiet = controls(READY, 'quiet');
    for (const repeat of DEVICE_CHECK_REPEATS) expect(quiet).not.toContain(repeat);
    // 남기기로 한 것: 작은 미리보기.
    expect(quiet).toContain('aria-label="내 웹캠 미리보기"');
    // 경기·점검 화면은 그대로 둔다. 문구 몇 개는 모드·장치 상태에 따라 하나만 나온다.
    const full =
      controls({ ...READY, microphone: 'ready' }, 'full') +
      controls({ ...READY, calibration: 'idle' }, 'full', 'keyboard');
    for (const repeat of DEVICE_CHECK_REPEATS) expect(full).toContain(repeat);
  });

  it('shows the recovery banner only once a tracking device actually dropped', () => {
    expect(controls(READY, 'quiet')).not.toContain('장치 다시 연결·점검');
    const lost = controls({ ...READY, camera: 'failed', errorCode: 'DEVICE_LOST' }, 'quiet');
    expect(lost).toContain('role="alert"');
    expect(lost).toContain('장치 다시 연결·점검');
    expect(lost).toContain('카메라 연결과 브라우저 권한을 확인');
    // 오류 code 가 없어도 끊긴 사실과 대안은 알린다.
    const silent = controls({ ...READY, vision: 'failed' }, 'quiet');
    expect(silent).toContain('키보드로 계속할 수 있습니다');
  });
});

describe('PracticeScreen', () => {
  const render = (role: 'runner' | 'tagger') => {
    const view = viewFixture();
    return renderToStaticMarkup(
      createElement(PracticeScreen, {
        round: roundFixture({ phase: 'TEAM_PRACTICE' }),
        view: {
          ...view,
          self: { ...view.self!, role },
          gameScope: { kind: 'practice', revision: 1, gameInstanceId: 'practice-team' },
        },
        devices: READY,
        readyReported: false,
        readSensors: () => null,
        onReady() {},
      }),
    );
  };

  it('no longer repeats the movement guidance and keeps the role practice and ready button', () => {
    for (const role of ['runner', 'tagger'] as const) {
      const html = render(role);
      expect(html).not.toContain('W/S로 전진·후진');
      expect(html).not.toContain('몸을 기울여 이동하고');
      expect(html).toContain('연습 준비 완료');
    }
    expect(render('runner')).toContain('출구에서 사용할 상체 포즈 연습');
    expect(render('tagger')).toContain('1·2로 장비');
  });

  // S15P21C204-278. 첫 경기 전에 한 번은 실제로 놓아 보게 민다.
  it('tells the tagger whether they have actually placed anything here yet', () => {
    expect(render('tagger')).toContain('아직 설치해 보지 않았어요');
    expect(render('runner')).not.toContain('아직 설치해 보지 않았어요');
  });
});
