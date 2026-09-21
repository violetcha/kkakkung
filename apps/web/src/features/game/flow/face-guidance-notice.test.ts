import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { faceConditionGuidance, type FaceCondition } from '../../media/face-condition';
import { INITIAL_DEVICES } from './device-readiness';
import { DeviceCheckScreen } from './DeviceCheckScreen';
import { FaceGuidanceNotice } from './FaceGuidanceNotice';
import { LoadingOverlay } from './LoadingOverlay';
import { roundFixture } from '../../room/product-fixture';

it('renders each face condition as its own status message and nothing without a notice', () => {
  const conditions: FaceCondition[] = ['turned-away', 'glare', 'backlit', 'occluded'];
  const messages = conditions.map((condition) => {
    const message = faceConditionGuidance(condition)!;
    const html = renderToStaticMarkup(
      createElement(FaceGuidanceNotice, { notice: { condition, message, isNew: true } }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain(`data-condition="${condition}"`);
    expect(html).not.toContain('익명');
    return message;
  });
  expect(new Set(messages).size).toBe(conditions.length);
  expect(renderToStaticMarkup(createElement(FaceGuidanceNotice, { notice: null }))).toBe('');
});

it('shows the guidance on the device check screen and annotated waits while loading', () => {
  const message = faceConditionGuidance('backlit')!;
  const check = renderToStaticMarkup(
    createElement(DeviceCheckScreen, {
      status: INITIAL_DEVICES,
      ready: false,
      onStart: async () => {},
      onReady() {},
      // 동의 게이트 뒤의 화면을 본다(S15P21C204-292).
      consented: true,
      onConsent() {},
      faceGuidance: { condition: 'backlit', message, isNew: true },
    }),
  );
  expect(check).toContain(message);
  const loading = renderToStaticMarkup(
    createElement(LoadingOverlay, {
      round: roundFixture({ phase: 'GAME_LOADING' }),
      serverNow: null,
      pending: ['카메라 연결(권한 확인 중 12초)'],
    }),
  );
  expect(loading).toContain('내 준비 대기: 카메라 연결(권한 확인 중 12초)');
});
