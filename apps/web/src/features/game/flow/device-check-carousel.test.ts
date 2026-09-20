import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { clearConsentedDevice, useConsentedDevice } from '../../room/consent-fixture';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { DeviceCheckScreen } from './DeviceCheckScreen';
import { INITIAL_DEVICES } from './device-readiness';

// 장치 점검은 동의 게이트 뒤에 있다(S15P21C204-292). 여기서 보는 것은 그 뒤 화면이다.
beforeAll(() => useConsentedDevice());
afterAll(() => clearConsentedDevice());

const render = (
  status: DeviceStatus,
  extra: Partial<Parameters<typeof DeviceCheckScreen>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(DeviceCheckScreen, {
      status,
      ready: false,
      onStart: async () => {},
      onReady() {},
      ...extra,
    }),
  );

const cameraReady = { ...INITIAL_DEVICES, camera: 'ready', vision: 'ready' } as const;
const postureReady = { ...cameraReady, calibration: 'ready' } as const;
const allReady = { ...postureReady, audioPlayback: 'ready' } as const;

const HEADINGS = ['1 · 카메라', '2 · 자세', '3 · 소리', '4 · 완료'] as const;

/** 지금 보이는 단계 제목 하나만 돌려준다. 두 단계가 같이 보이면 시험이 실패한다. */
const visibleStep = (html: string) => {
  const shown = HEADINGS.filter((heading) => html.includes(heading));
  expect(shown).toHaveLength(1);
  return shown[0];
};

it('shows one step at a time and moves to the next as each device group passes', () => {
  expect(visibleStep(render(INITIAL_DEVICES))).toBe('1 · 카메라');
  expect(visibleStep(render(cameraReady))).toBe('2 · 자세');
  expect(visibleStep(render(postureReady))).toBe('3 · 소리');
  expect(visibleStep(render(allReady))).toBe('4 · 완료');
});

it('shows every step in the progress dots and marks the current one', () => {
  const html = render(cameraReady);
  for (const label of ['카메라', '자세', '소리', '완료']) expect(html).toContain(label);
  expect(html).toContain('aria-label="장치 점검 진행"');
  expect(html).toContain('aria-current="step"');
  // 막힌 단계에 갇히지 않도록 어느 점이든 누를 수 있다.
  expect(html).not.toMatch(/class="device-check-dot"[^>]*disabled/);
});

it('keeps an error message inside the step that owns its code', () => {
  const calibration = render({
    ...cameraReady,
    calibration: 'failed',
    errorCode: 'CALIBRATION_NO_FACE',
  });
  expect(visibleStep(calibration)).toBe('2 · 자세');
  expect(calibration).toContain('role="alert"');
  // 카메라 단계에 머무는 동안에는 보정 오류 문구가 새지 않는다.
  const onCameraStep = render({ ...INITIAL_DEVICES, errorCode: 'CALIBRATION_NO_FACE' });
  expect(visibleStep(onCameraStep)).toBe('1 · 카메라');
  expect(onCameraStep).not.toContain('role="alert"');
  const camera = render({ ...INITIAL_DEVICES, camera: 'failed', errorCode: 'PERMISSION_DENIED' });
  expect(camera).toContain('role="alert"');
});

it('waits on the posture step until both motion confirmations are seen', () => {
  const pending = render(postureReady, { motion: { lean: true, turn: false } });
  expect(visibleStep(pending)).toBe('2 · 자세');
  expect(pending).toContain('aria-label="동작 확인"');
  expect(pending).toContain('data-done="true"');
  expect(pending).toContain('data-done="false"');
  expect(visibleStep(render(postureReady, { motion: { lean: true, turn: true } }))).toBe(
    '3 · 소리',
  );
});

it('only offers ready when every device passed and only where ready can be reported', () => {
  expect(render(allReady)).toContain('준비 완료');
  const blocked = render({ ...postureReady, audioPlayback: 'failed' });
  expect(visibleStep(blocked)).toBe('3 · 소리');
  expect(blocked).not.toContain('준비 완료');
  // 개인 체험처럼 보고할 곳이 없는 화면은 준비 단추를 그리지 않는다.
  expect(render(allReady, { onReady: undefined })).not.toContain('준비 완료');
  expect(render(allReady, { ready: true })).toContain('준비 취소');
});
