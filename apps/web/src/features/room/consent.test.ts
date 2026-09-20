// S15P21C204-292. 동의 기록의 판정과 저장. 저장소가 막힌 브라우저에서도 던지지 않아야 한다.
import { expect, it, vi } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  browserConsentStorage,
  consentSatisfies,
  hasConsented,
  parseConsent,
  rememberConsent,
  type ConsentStorage,
} from './consent';
import { PRIVACY_NOTICE_VERSION } from './privacy-notice';

function memoryStorage(initial: string | null = null): ConsentStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === CONSENT_STORAGE_KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === CONSENT_STORAGE_KEY) this.value = value;
    },
  };
}

it('reads only a complete record', () => {
  expect(parseConsent(null)).toBeNull();
  expect(parseConsent('')).toBeNull();
  expect(parseConsent('not json')).toBeNull();
  expect(parseConsent('"a string"')).toBeNull();
  expect(parseConsent(JSON.stringify({ version: 'v', atMs: 1 }))).toBeNull();
  // 연령 확인이 빠진 기록은 동의가 아니다.
  expect(parseConsent(JSON.stringify({ version: 'v', atMs: 1, ageConfirmed: false }))).toBeNull();
  expect(parseConsent(JSON.stringify({ version: '', atMs: 1, ageConfirmed: true }))).toBeNull();
  expect(parseConsent(JSON.stringify({ version: 'v', atMs: 'x', ageConfirmed: true }))).toBeNull();
  expect(parseConsent(JSON.stringify({ version: 'v', atMs: 5, ageConfirmed: true }))).toEqual({
    version: 'v',
    atMs: 5,
    ageConfirmed: true,
  });
});

it('treats a different notice version as no consent at all', () => {
  const record = { version: 'old', atMs: 1, ageConfirmed: true } as const;
  expect(consentSatisfies(record, 'old')).toBe(true);
  expect(consentSatisfies(record, 'new')).toBe(false);
  expect(consentSatisfies(null, 'old')).toBe(false);
});

it('remembers and then recognises a consent', () => {
  const storage = memoryStorage();
  expect(hasConsented(storage)).toBe(false);
  expect(rememberConsent(storage, 1_700_000_000_000)).toBe(true);
  expect(hasConsented(storage)).toBe(true);
  expect(parseConsent(storage.value)).toMatchObject({
    version: PRIVACY_NOTICE_VERSION,
    ageConfirmed: true,
  });
  // 안내문이 바뀌면 같은 기록으로는 통과하지 못한다.
  expect(hasConsented(storage, 'a-later-version')).toBe(false);
});

it('never throws when the browser refuses storage', () => {
  const blocked: ConsentStorage = {
    getItem() {
      throw new DOMException('denied', 'SecurityError');
    },
    setItem() {
      throw new DOMException('denied', 'SecurityError');
    },
  };
  expect(hasConsented(blocked)).toBe(false);
  expect(rememberConsent(blocked, 1)).toBe(false);
  expect(hasConsented(null)).toBe(false);
  expect(rememberConsent(undefined, 1)).toBe(false);
});

it('hands back null instead of throwing when localStorage itself is unreachable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  try {
    expect(browserConsentStorage()).toBeNull();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
  vi.restoreAllMocks();
});
