/**
 * S15P21C204-367. `/demo`·`/showcase` 운영자 목록. 로그인 게이트가 SSAFY 계정 전체를 통과시키므로
 * 이 목록이 두 관리 경로의 유일한 운영자 판정이다. 닫힌 쪽으로 실패해야 한다.
 */
import { describe, expect, it } from 'vitest';
import {
  fileOperatorAllowlist,
  isOperatorRequest,
  parseOperatorEmails,
} from '../../src/session/operator-allowlist.js';

describe('operator allowlist', () => {
  it('reads one email per line, skipping blanks and comments, ignoring case', () => {
    const emails = parseOperatorEmails('# 운영자\r\nA@Example.com\n\n  b@example.com  \n#c@x\n');
    expect([...emails]).toEqual(['a@example.com', 'b@example.com']);
  });

  it('admits only listed emails and re-reads the file on every check', () => {
    let text = 'a@example.com\n';
    const allowed = fileOperatorAllowlist('/list', () => text);
    expect(allowed('A@example.com')).toBe(true);
    expect(allowed('b@example.com')).toBe(false);
    // 운영자가 목록을 고치면 재시작 없이 반영된다.
    text = 'b@example.com\n';
    expect(allowed('a@example.com')).toBe(false);
    expect(allowed('b@example.com')).toBe(true);
  });

  it('admits nobody when the path is unset, the file is unreadable or the identity is blank', () => {
    expect(fileOperatorAllowlist(null)('a@example.com')).toBe(false);
    const missing = fileOperatorAllowlist('/missing', () => {
      throw new Error('ENOENT');
    });
    expect(missing('a@example.com')).toBe(false);
    expect(fileOperatorAllowlist('/list', () => '\n')(' ')).toBe(false);
  });

  it('trusts the header only behind the trusted proxy', () => {
    const request = { headers: { 'x-demo-admin': 'a@example.com' } };
    const allowed = () => true;
    expect(isOperatorRequest(request, true, allowed)).toBe(true);
    expect(isOperatorRequest(request, false, allowed)).toBe(false);
    expect(isOperatorRequest({ headers: {} }, true, allowed)).toBe(false);
    expect(isOperatorRequest(request, true, () => false)).toBe(false);
  });
});
