import { describe, expect, it } from 'vitest';

import { clientOrigin, originKeyOf } from '../../src/session/client-origin.js';

describe('출처 키', () => {
  it('IPv4 는 그대로 센다', () => {
    expect(originKeyOf('203.0.113.7')).toBe('203.0.113.7');
    expect(originKeyOf(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('IPv4-mapped IPv6 를 IPv4 와 같은 출처로 센다', () => {
    // 같은 사람이 스택에 따라 두 표기로 도착한다. 다른 키가 되면 상한이 두 배가 된다.
    expect(originKeyOf('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(originKeyOf('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(originKeyOf('[::ffff:203.0.113.7]')).toBe('203.0.113.7');
  });

  it('IPv6 는 /64 로 접어 임시 주소 회전을 한 출처로 묶는다', () => {
    const first = originKeyOf('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
    const rotated = originKeyOf('2001:db8:1234:5678:1111:2222:3333:4444');
    expect(first).toBe('2001:db8:1234:5678::/64');
    expect(rotated).toBe(first);
  });

  it('다른 /64 는 다른 출처다', () => {
    expect(originKeyOf('2001:db8:1234:5678::1')).not.toBe(originKeyOf('2001:db8:1234:9999::1'));
  });

  it('축약·대문자·zone id 표기를 같은 키로 모은다', () => {
    const canonical = '2001:db8:0:1::/64';
    expect(originKeyOf('2001:0db8:0000:0001:0000:0000:0000:0001')).toBe(canonical);
    expect(originKeyOf('2001:DB8:0:1::1')).toBe(canonical);
    expect(originKeyOf('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('빈 값과 알아볼 수 없는 표기에는 출처를 지어내지 않는다', () => {
    expect(originKeyOf(null)).toBeNull();
    expect(originKeyOf(undefined)).toBeNull();
    expect(originKeyOf('   ')).toBeNull();
    // 넓게 묶으면 남을 같은 출처로 만든다. 모르면 원문을 그대로 키로 쓴다.
    expect(originKeyOf('2001:db8::1::2')).toBe('2001:db8::1::2');
    expect(originKeyOf('not-an-address')).toBe('not-an-address');
  });
});

describe('요청 출처', () => {
  const req = (headers: Record<string, string | string[]>, remoteAddress?: string) => ({
    headers,
    socket: remoteAddress === undefined ? undefined : { remoteAddress },
  });

  it('프록시를 신뢰하면 맨 앞 항목을 접어서 쓴다', () => {
    // 호스트 nginx 가 이 헤더를 덮어쓰므로 맨 앞이 실제 접속자다.
    expect(
      clientOrigin(req({ 'x-forwarded-for': '2001:db8:1:2:3:4:5:6, 10.0.0.1' }, '10.0.0.1'), true),
    ).toBe('2001:db8:1:2::/64');
  });

  it('프록시를 신뢰하지 않으면 붙여 보낸 헤더를 아예 읽지 않는다', () => {
    // 직접 붙인 헤더로 제한을 우회할 수 없어야 한다.
    expect(clientOrigin(req({ 'x-forwarded-for': '198.51.100.9' }, '203.0.113.7'), false)).toBe(
      '203.0.113.7',
    );
  });

  it('신뢰하더라도 헤더가 비었으면 소켓 주소로 내려간다', () => {
    expect(clientOrigin(req({ 'x-forwarded-for': '   ' }, '::ffff:203.0.113.7'), true)).toBe(
      '203.0.113.7',
    );
    expect(clientOrigin(req({}, '203.0.113.7'), true)).toBe('203.0.113.7');
  });

  it('배열로 온 헤더도 맨 앞을 쓴다', () => {
    expect(
      clientOrigin(req({ 'x-forwarded-for': ['198.51.100.9', '10.0.0.1'] }, '10.0.0.1'), true),
    ).toBe('198.51.100.9');
  });

  it('주소를 전혀 알 수 없으면 null 이다', () => {
    expect(clientOrigin(req({}), true)).toBeNull();
  });
});
