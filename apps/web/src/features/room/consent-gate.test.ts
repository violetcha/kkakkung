// S15P21C204-292. 동의 전에는 장치를 켤 수 있는 것이 화면에 없어야 한다.
//
// 이 저장소의 web 시험은 node 환경에서 renderToStaticMarkup 으로 돈다(브라우저 DOM 없음).
// 그래서 클릭이 아니라 "무엇이 그려지는가"로 고정한다. 동의 전 화면에 장치 점검 제어가 아예
// 없다는 것이 곧 onStart 를 부를 방법이 없다는 뜻이다.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { ConsentGate } from './ConsentGate';
import { CONSENT_STORAGE_KEY, consentGiven, forgetSessionConsent } from './consent';
import { PRIVACY_NOTICE, PRIVACY_NOTICE_VERSION } from './privacy-notice';
import { DeviceCheckScreen } from '../game/flow/DeviceCheckScreen';
import type { DeviceStatus } from '../input/InteractionRuntime';

const status: DeviceStatus = {
  camera: 'idle',
  microphone: 'off',
  inference: 'idle',
  calibration: 'idle',
  errorCode: null,
} as unknown as DeviceStatus;

function withStoredConsent(raw: string | null) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key === CONSENT_STORAGE_KEY ? raw : null),
      setItem: () => undefined,
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  forgetSessionConsent();
});

it('asks for both confirmations and keeps the button disabled until then', () => {
  const html = renderToStaticMarkup(createElement(ConsentGate, { onAccept() {} }));
  expect(html).toContain('위 내용을 읽고 동의합니다');
  expect(html).toContain('만 14세 이상입니다');
  // 서버 렌더는 초기 상태다: 아직 아무것도 체크하지 않았으므로 버튼이 잠겨 있어야 한다.
  expect(html).toMatch(/<button[^>]*disabled[^>]*>동의하고 장치 점검으로<\/button>/);
  expect(html).toContain(PRIVACY_NOTICE_VERSION);
});

it('shows every notice sentence, including the tampering risk', () => {
  const html = renderToStaticMarkup(createElement(ConsentGate, { onAccept() {} }));
  for (const sentence of PRIVACY_NOTICE) expect(html).toContain(sentence.text);
  // 기획서 §18.2 가 요구하는 변조 송신 위험.
  expect(html).toContain('변조된 프로그램을 쓰는 참가자는 가공되지 않은 영상을 보낼 수도 있습니다');
  expect(html).not.toContain('익명');
});

const screen = (consented: boolean) =>
  renderToStaticMarkup(
    createElement(DeviceCheckScreen, {
      status,
      onStart: async () => {},
      consented,
      onConsent() {},
    }),
  );

it('replaces the device controls until the notice is accepted', () => {
  const gated = screen(false);
  expect(gated).toContain('개인정보 처리 동의');
  // 장치를 켜는 화면 자체가 없다.
  expect(gated).not.toContain('aria-label="장치 점검"');

  const open = screen(true);
  expect(open).toContain('aria-label="장치 점검"');
  expect(open).not.toContain('개인정보 처리 동의');
});

it('asks again when the notice version moved on', () => {
  // 판정은 화면이 아니라 `consentGiven` 이 한다(S15P21C204-292). 옛 판에 눌린 동의는 동의가 아니다.
  withStoredConsent(JSON.stringify({ version: 'older', atMs: 1, ageConfirmed: true }));
  expect(consentGiven()).toBe(false);
  withStoredConsent(
    JSON.stringify({ version: PRIVACY_NOTICE_VERSION, atMs: 1, ageConfirmed: true }),
  );
  expect(consentGiven()).toBe(true);
});
