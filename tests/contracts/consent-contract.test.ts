// S15P21C204-292. e2e 도우미가 복제한 동의 값이 원본과 같은지.
//
// e2e 는 앱 소스를 import 하지 않는 관례라 저장소 키와 안내문 판을 손으로 복제했다. 안내문을
// 고치면서 판만 올리면 e2e 는 옛 판으로 동의를 심고, 모든 시험이 게이트에 막혀 원인을 찾느라
// 시간을 쓴다. 여기서 두 벌을 대조한다.
import { expect, it } from 'vitest';
import { CONSENT_STORAGE_KEY } from '../../apps/web/src/features/room/consent';
import {
  PRIVACY_NOTICE,
  PRIVACY_NOTICE_VERSION,
} from '../../apps/web/src/features/room/privacy-notice';
import { E2E_CONSENT_STORAGE_KEY, E2E_PRIVACY_NOTICE_VERSION } from '../e2e/consent';

it('keeps the e2e consent helper identical to the app constants', () => {
  expect(E2E_CONSENT_STORAGE_KEY).toBe(CONSENT_STORAGE_KEY);
  expect(E2E_PRIVACY_NOTICE_VERSION).toBe(PRIVACY_NOTICE_VERSION);
});

it('states the tampering risk the spec requires before the camera turns on', () => {
  // 기획서 §18.2: 변조 송신 위험을 안내한다. 문장을 지우면 여기서 걸린다.
  const risk = PRIVACY_NOTICE.find((sentence) => sentence.text.includes('변조된 프로그램'));
  expect(risk, '변조 송신 위험 문장이 없다').toBeDefined();
  expect(risk!.evidence).toContain('server/src/media/GrantIssuer.ts');
});
