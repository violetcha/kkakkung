// S15P21C204-292. 장치 점검 화면을 렌더하는 시험용 도우미.
//
// 카메라를 켜는 화면은 동의 게이트 뒤에 있다. 게이트가 아니라 그 뒤 화면을 보는 시험은
// "이미 동의한 기기"에서 시작해야 한다. node 환경에는 localStorage 가 없으므로 여기서 심는다.
import { CONSENT_STORAGE_KEY } from './consent';
import { PRIVACY_NOTICE_VERSION } from './privacy-notice';

/** 이미 동의한 기기로 만든다. 되돌리려면 `clearConsentedDevice`. */
export function useConsentedDevice(version = PRIVACY_NOTICE_VERSION): void {
  const record = JSON.stringify({ version, atMs: 1_700_000_000_000, ageConfirmed: true });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key === CONSENT_STORAGE_KEY ? record : null),
      setItem: () => undefined,
    },
  });
}

export function clearConsentedDevice(): void {
  Reflect.deleteProperty(globalThis, 'localStorage');
}
