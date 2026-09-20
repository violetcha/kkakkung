// S15P21C204-292. 동의 게이트를 미리 통과시키는 도우미.
//
// e2e 는 앱 소스를 import 하지 않는 관례라 값을 여기에 복제한다. 원본은
// apps/web/src/features/room/consent.ts 와 privacy-notice.ts 이고, 두 값이 어긋나면
// tests/contracts/consent-contract.test.ts 가 잡는다.
//
// 게이트 자체를 보는 시험은 이 도우미를 쓰지 않고 화면에서 직접 동의한다.
import type { Page } from '@playwright/test';

export const E2E_CONSENT_STORAGE_KEY = 'kkakkung.media-consent';
export const E2E_PRIVACY_NOTICE_VERSION = '2026-09-20';

/** 기기가 이미 동의한 상태로 페이지를 연다. `page.goto` 전에 부른다. */
export async function seedMediaConsent(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, version]) => {
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({ version, atMs: Date.now(), ageConfirmed: true }),
        );
      } catch {
        // 저장소가 막힌 환경이면 시험이 게이트를 만나고 거기서 실패한다. 숨기지 않는다.
      }
    },
    [E2E_CONSENT_STORAGE_KEY, E2E_PRIVACY_NOTICE_VERSION] as const,
  );
}
