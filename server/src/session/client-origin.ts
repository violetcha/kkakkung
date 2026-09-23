/**
 * S15P21C204-300. 요청 하나를 "출처"로 접는다. 속도 제한과 게스트 방 상한은 이 값 하나로
 * 센다.
 *
 * 주소를 그대로 쓰면 두 가지가 샌다. IPv6 는 같은 회선이 주소를 계속 바꾸므로(임시 주소)
 * 한 사람이 키를 무한히 만들 수 있고, IPv4-mapped IPv6(`::ffff:1.2.3.4`)는 같은 사람을
 * `1.2.3.4` 와 다른 키로 센다. 그래서 IPv6 는 배정 단위인 /64 로 접고 mapped 는 IPv4 로
 * 되돌린다.
 *
 * 되돌릴 수 없는 트레이드오프가 하나 있다. **같은 IPv4 뒤의 사람들은 한 출처로 묶인다.**
 * 학교·사무실 NAT 가 그렇다. 그래서 출처당 방 상한은 "한 사람이 여는 방 수"가 아니라
 * "한 회선이 동시에 여는 방 수"이고, 상한 값은 그 전제로 정한다(`MAX_ROOMS_PER_ORIGIN`).
 * 같은 망의 6인이 방 하나에 초대로 모이는 정상 흐름은 방을 하나만 만들므로 영향이 없다.
 * 팀 SSO 방 생성은 이 출처가 아니라 SSO 계정으로 센다(`MAX_ROOMS_PER_ACCOUNT`, S15P21C204-366).
 *
 * 이 모듈은 주소를 저장하지 않는다. 부르는 쪽이 필요하면 해시해서 쓴다.
 */
import type { IncomingMessage } from 'node:http';

/** IPv6 를 접는 단위. 한 가입자에게 배정되는 최소 크기다. */
const IPV6_PREFIX_GROUPS = 4;

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

type HeaderSource = Readonly<{
  headers: IncomingMessage['headers'];
  socket?: { remoteAddress?: string | undefined } | undefined;
}>;

/** 8그룹으로 편 IPv6. 표기가 유효하지 않으면 null. */
function expandIpv6(address: string): string[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
      : head;
  if (groups.length !== 8) return null;
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => parseInt(group, 16).toString(16));
}

/**
 * 주소 하나를 출처 키로 접는다. 알아볼 수 없는 표기는 **그대로 돌려준다.** 임의로 넓게
 * 묶어 남을 같은 출처로 만들지 않기 위해서다.
 */
export function originKeyOf(address: string | null | undefined): string | null {
  if (typeof address !== 'string') return null;
  // 대괄호와 zone id(`fe80::1%eth0`)를 떼고 본다.
  const bare =
    address
      .trim()
      .replace(/^\[|\]$/g, '')
      .split('%')[0]
      ?.trim() ?? '';
  if (bare === '') return null;
  const mapped = IPV4_MAPPED.exec(bare);
  if (mapped) return mapped[1]!;
  if (IPV4.test(bare)) return bare;
  if (!bare.includes(':')) return bare;
  const groups = expandIpv6(bare);
  if (!groups) return bare;
  return `${groups.slice(0, IPV6_PREFIX_GROUPS).join(':')}::/64`;
}

/**
 * 요청의 출처 키. `trustProxy` 일 때만 `X-Forwarded-For` 를 본다.
 *
 * 호스트 nginx 가 이 헤더를 `$remote_addr` 로 **덮어쓰므로** 맨 앞이 실제 접속자다. 신뢰하지
 * 않는 구성에서는 헤더를 아예 읽지 않아 호출자가 붙인 값이 제한을 우회하지 못한다.
 */
export function clientOrigin(req: HeaderSource, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    const key = originKeyOf(first);
    if (key !== null) return key;
  }
  return originKeyOf(req.socket?.remoteAddress);
}
