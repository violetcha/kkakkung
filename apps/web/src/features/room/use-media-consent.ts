// S15P21C204-292. 동의 상태를 화면 조립의 한 곳에서 들고 있는다.
//
// 처음에는 장치 점검 화면이 스스로 기억했다. 그런데 장치 단추를 그리는 곳은 그 화면만이 아니어서
// (`LocalControls`) 한쪽만 막혔다. 화면마다 따로 기억하면 같은 일이 또 생기므로, 한 곳에서 받아
// 필요한 화면에 내려 준다.
import { useCallback, useState } from 'react';
import {
  browserConsentStorage,
  consentGiven,
  markConsented,
  rememberConsent,
  type ConsentStorage,
} from './consent';

export type MediaConsent = Readonly<{
  /** 지금 카메라·마이크를 켜도 되는지. */
  consented: boolean;
  /** 동의 화면을 통과했을 때 부른다. */
  accept(): void;
}>;

export function useMediaConsent(
  openStorage: () => ConsentStorage | null = browserConsentStorage,
): MediaConsent {
  const [storage] = useState(openStorage);
  const [consented, setConsented] = useState(() => consentGiven(storage));
  const accept = useCallback(() => {
    // 저장에 실패해도(사생활 보호 모드 등) 이번 진행은 막지 않는다. 다음 방문에 다시 묻는다.
    rememberConsent(storage, Date.now());
    markConsented();
    setConsented(true);
  }, [storage]);
  return { consented, accept };
}
