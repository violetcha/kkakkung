/**
 * S15P21C204-367. `/demo`·`/showcase` 를 여는 운영자 등록 이메일 목록.
 *
 * 로그인 게이트(oauth2-proxy)는 SSAFY GitLab 계정 전체를 통과시킨다. 그래서 두 관리 경로의
 * "누가 운영자인가"는 게이트가 아니라 여기서 정한다. 호스트 nginx 가 게이트가 확인한 로그인
 * 이메일로 `X-Demo-Admin` 을 덮어쓰고, 서버는 그 값이 이 목록에 있을 때만 받는다.
 *
 * 목록은 운영자가 호스트 파일로 관리한다(`/opt/kkakkung/sso-access/allowed-emails.txt`). 요청마다
 * 다시 읽어 재시작 없이 추가·제거가 반영된다. 관리 경로는 드물게 불리고 파일은 몇 줄이다.
 * 경로가 없거나 파일을 읽을 수 없으면 아무도 통과시키지 않는다(닫힌 쪽으로 실패).
 */
import { readFileSync } from 'node:fs';

/** 로그인 이메일 하나가 운영자인지. 신뢰 프록시 확인은 부르는 쪽이 따로 한다. */
export type OperatorAllowlist = (identity: string) => boolean;

/** 한 줄에 이메일 하나. 빈 줄과 `#` 주석은 건너뛰고 대소문자는 구분하지 않는다. */
export function parseOperatorEmails(text: string): ReadonlySet<string> {
  const emails = new Set<string>();
  for (const line of text.split('\n')) {
    const email = line.trim().toLowerCase();
    if (email.length > 0 && !email.startsWith('#')) emails.add(email);
  }
  return emails;
}

export function fileOperatorAllowlist(
  path: string | null,
  read: (path: string) => string = (file) => readFileSync(file, 'utf8'),
): OperatorAllowlist {
  if (path === null) return () => false;
  return (identity) => {
    const email = identity.trim().toLowerCase();
    if (email.length === 0) return false;
    try {
      return parseOperatorEmails(read(path)).has(email);
    } catch {
      return false;
    }
  };
}

/**
 * 신뢰 프록시가 덮어쓴 `X-Demo-Admin`(로그인 이메일)이 목록에 있는가. `trustedProxy` 없이는
 * 호출자가 직접 붙인 헤더일 수 있어 보지 않는다.
 */
export function isOperatorRequest(
  request: Readonly<{ headers: Readonly<Record<string, string | string[] | undefined>> }>,
  trustedProxy: boolean,
  allowed: OperatorAllowlist,
): boolean {
  const identity = request.headers['x-demo-admin'];
  return (
    trustedProxy &&
    typeof identity === 'string' &&
    identity.trim().length > 0 &&
    identity.length <= 256 &&
    allowed(identity)
  );
}
