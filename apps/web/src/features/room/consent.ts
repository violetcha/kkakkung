// S15P21C204-292. 카메라를 켜기 전에 받은 동의의 기록.
//
// 동의는 사람이 "그때 그 문장"을 읽고 누른 것이므로 안내문 판(`PRIVACY_NOTICE_VERSION`)과 함께
// 남긴다. 판이 올라가면 이전 동의는 더 이상 이 안내문에 대한 동의가 아니므로 다시 묻는다.
//
// 저장소는 사생활 보호 모드·차단된 쿠키 설정에서 읽기만 해도 던질 수 있다. 여기서는 어떤 경우도
// 던지지 않고 "동의 없음"으로 답한다. 기록하지 못하면 매번 다시 묻게 되는데, 묻는 쪽이 안전하다.
import { PRIVACY_NOTICE_VERSION } from './privacy-notice';

export const CONSENT_STORAGE_KEY = 'kkakkung.media-consent';

export type ConsentRecord = Readonly<{
  /** 동의한 안내문의 판. */
  version: string;
  /** 기기 시계 기준 동의 시각. 표시용이며 판정에 쓰지 않는다. */
  atMs: number;
  /** 만 14세 이상이라고 밝혔는지. 둘 다 받아야 진행한다. */
  ageConfirmed: boolean;
}>;

/** 브라우저 저장소 중 이 모듈이 쓰는 부분만. 시험이 가짜를 넣을 수 있다. */
export type ConsentStorage = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}>;

/** 저장된 문자열을 기록으로 읽는다. 형식이 깨졌으면 null. 던지지 않는다. */
export function parseConsent(raw: string | null): ConsentRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.version !== 'string' || record.version.length === 0) return null;
    if (typeof record.atMs !== 'number' || !Number.isFinite(record.atMs)) return null;
    if (record.ageConfirmed !== true) return null;
    return { version: record.version, atMs: record.atMs, ageConfirmed: true };
  } catch {
    return null;
  }
}

/** 지금 보여 주는 안내문에 대한 동의인지. 판이 다르면 동의가 아니다. */
export function consentSatisfies(
  record: ConsentRecord | null,
  version = PRIVACY_NOTICE_VERSION,
): boolean {
  return record !== null && record.version === version && record.ageConfirmed;
}

/** 저장소를 읽어 지금 안내문에 동의했는지 답한다. 저장소가 막혀 있으면 false. */
export function hasConsented(
  storage: ConsentStorage | null | undefined,
  version = PRIVACY_NOTICE_VERSION,
): boolean {
  if (!storage) return false;
  try {
    return consentSatisfies(parseConsent(storage.getItem(CONSENT_STORAGE_KEY)), version);
  } catch {
    return false;
  }
}

/**
 * 동의를 남긴다. 저장하지 못해도 던지지 않고 false 를 돌려준다. 호출자는 그래도 진행하되,
 * 다음 방문에 다시 묻게 된다.
 */
export function rememberConsent(
  storage: ConsentStorage | null | undefined,
  nowMs: number,
  version = PRIVACY_NOTICE_VERSION,
): boolean {
  if (!storage) return false;
  const record: ConsentRecord = { version, atMs: nowMs, ageConfirmed: true };
  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** 브라우저의 localStorage. 접근 자체가 던지는 환경에서는 null. */
export function browserConsentStorage(): ConsentStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
