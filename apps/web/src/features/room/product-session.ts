import { Client } from '@colyseus/sdk';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import {
  DEMO_ADMIN_ROOM_ROUTE,
  demoRoomRequestSchema,
  demoRoomResponseSchema,
  SHOWCASE_ROOM_ROUTE,
  showcaseRoomRequestSchema,
  showcaseRoomResponseSchema,
  type ShowcaseRoomRequest,
  type ShowcaseRoomResponse,
  ROOM_CODE_PATTERN,
  sessionRequestSchema,
  sessionResponseSchema,
  SESSION_ERROR_CODES,
  SESSION_CANCEL_ROUTE,
  SESSION_ACCESS_ROUTE,
  sessionAccessResponseSchema,
  type DemoRoomRequest,
  type DemoRoomResponse,
  type SessionAccessResponse,
  type SessionRequest,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import type { Room } from '@colyseus/sdk';
import type { ProductRoomPort } from '../../app/product-runtime';

/** Non-secret navigation hint only. Server invitation scope still authorizes the actual room. */
export function invitationRoom(hash: string): string {
  const room = new URLSearchParams(hash.replace(/^#/, '')).get('room') ?? '';
  return /^[A-HJ-NP-Z2-9]{6}$/.test(room) ? room : '';
}

export function consumeInvitation(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
) {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get('inviteToken') ?? params.get('invite') ?? '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return token;
}

export async function requestSessionAccess(
  fetcher: typeof fetch = fetch,
): Promise<SessionAccessResponse> {
  const response = await fetcher(SESSION_ACCESS_ROUTE, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  // Older/diagnostic servers retain invitation admission until they implement this contract.
  if (response.status === 404) return { method: 'invitation' };
  if (!response.ok) throw new Error('CONNECTION_FAILED');
  return sessionAccessResponseSchema.parse(await response.json());
}

export async function requestSession(
  input: SessionRequest,
  fetcher: typeof fetch = fetch,
): Promise<SessionResponse> {
  const parsed = sessionRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error('INVALID_REQUEST');
  let response: Response;
  try {
    response = await fetcher('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw new Error('CONNECTION_FAILED');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body ? body.error : null;
    throw new Error(SESSION_ERROR_CODES.find((item) => item === code) ?? 'CONNECTION_FAILED');
  }
  const result = sessionResponseSchema.safeParse(body);
  if (!result.success) throw new Error('INVALID_RESPONSE');
  return result.data;
}

/**
 * Requests a one-seat operator demo after the host's `/demo` SSO boundary has authorized this
 * browser. There is deliberately no operations Bearer here: the browser never receives one.
 */
export async function requestDemoRoom(
  input: DemoRoomRequest,
  fetcher: typeof fetch = fetch,
): Promise<DemoRoomResponse> {
  const parsed = demoRoomRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error('INVALID_REQUEST');
  let response: Response;
  try {
    response = await fetcher(DEMO_ADMIN_ROOM_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw new Error('CONNECTION_FAILED');
  }
  if (!response.ok) {
    // S15P21C204-312. 503 은 "다른 데모 방이 열려 있음"과 "서비스가 참" 을 함께 뜻한다. 서버가
    // 준 코드를 붙여 화면이 운영자에게 할 일을 나눠 알릴 수 있게 한다.
    const body: unknown = await response.json().catch(() => null);
    const code =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : null;
    throw new Error(`DEMO_REQUEST_FAILED:${response.status}${code ? ':' + code : ''}`);
  }
  const result = demoRoomResponseSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new Error('INVALID_RESPONSE');
  return result.data;
}

function roomServerUrl() {
  const configured = (import.meta.env.VITE_COLYSEUS_URL as string | undefined)?.trim();
  return configured || (import.meta.env.DEV ? 'ws://127.0.0.1:2567' : window.location.origin);
}

/** S15P21C204-396. 새로고침 뒤 같은 경기 자리로 돌아간다. 서버가 25초 비워 둔 자리다(391). */
export function reconnectProductRoom(reconnectionToken: string) {
  return new Client(roomServerUrl()).reconnect<PublicMatchState>(reconnectionToken);
}

export function joinProductRoom(session: SessionResponse) {
  const url = roomServerUrl();
  return new Client(url).joinOrCreate<PublicMatchState>('kkakkung', {
    token: session.sessionToken,
    roomCode: session.roomCode,
    protocolVersion: PRODUCT_PROTOCOL_VERSION,
  });
}

/** Best effort: the server's short admission deadline covers closed pages/lost responses. */
export async function cancelSessionReservation(
  session: SessionResponse,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await fetcher(SESSION_CANCEL_ROUTE, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${session.sessionToken}` },
    cache: 'no-store',
    keepalive: true,
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  }).catch(() => undefined);
}

/**
 * S15P21C204-391. 경기 중 끊기면 서버가 같은 자리를 25초 비워 둔다(MATCH_REJOIN_GRACE_MS). SDK 의 자동
 * 재접속으로 그 안에 같은 연결로 돌아간다. 재시도 간격은 0.5초에서 3초까지 늘고 10번이면 약 27초라 서버
 * 유예를 조금 넘긴다. 끊긴 동안 보낸 명령은 버린다: 돌아간 뒤 오래된 이동·설치가 한꺼번에 도착하면 안 된다.
 */
export const ROOM_RECONNECTION = Object.freeze({
  maxRetries: 10,
  delay: 500,
  minDelay: 500,
  maxDelay: 3000,
  maxEnqueuedMessages: 0,
});

export function productRoomPort(room: Room<unknown, PublicMatchState>): ProductRoomPort {
  Object.assign(room.reconnection, { enabled: true, ...ROOM_RECONNECTION });
  return {
    get state() {
      return room.state;
    },
    send: (type, payload) => room.send(type, payload),
    onMessage: (type, handler) => room.onMessage(type, handler),
    onStateChange(handler) {
      room.onStateChange(handler);
      return () => room.onStateChange.remove(handler);
    },
    // 끊김(drop)은 재접속을 시도하는 중이라 떠난 것이 아니다. 재시도가 모두 실패해야 onLeave 가 온다.
    onLeave(handler) {
      room.onLeave(handler);
      return () => room.onLeave.remove(handler);
    },
    onConnection(handler) {
      const dropped = () => handler('dropped');
      const restored = () => handler('restored');
      room.onDrop(dropped);
      room.onReconnect(restored);
      return () => {
        room.onDrop.remove(dropped);
        room.onReconnect.remove(restored);
      };
    },
    // 재접속 시도 중의 소켓 오류는 다음 시도로 넘어가는 과정이다. 그때는 끊김으로 알리지 않는다.
    onError(handler) {
      const report = () => {
        if (!room.reconnection.isReconnecting) handler();
      };
      room.onError(report);
      return () => room.onError.remove(report);
    },
    leave: () => (room.connection.isOpen ? room.leave() : Promise.resolve()),
  };
}

/**
 * 발표 시연 방 자리를 받는다. `/showcase` 의 SSO 경계를 지난 브라우저만 닿고 운영 토큰은 없다.
 * 409 ROLE_FULL 은 고른 역할 두 자리가 찼다는 뜻이라 호출 측이 다른 역할을 고르게 안내한다.
 */
export async function requestShowcaseRoom(
  input: ShowcaseRoomRequest,
  fetcher: typeof fetch = fetch,
): Promise<ShowcaseRoomResponse> {
  const parsed = showcaseRoomRequestSchema.safeParse(input);
  if (!parsed.success) throw new Error('INVALID_REQUEST');
  let response: Response;
  try {
    response = await fetcher(SHOWCASE_ROOM_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch {
    throw new Error('CONNECTION_FAILED');
  }
  if (!response.ok) {
    // S15P21C204-362. 같은 503 이라도 서버가 닫힌 것(ADMISSION_CLOSED)과 방이 찬 것(CAPACITY)은
    // 안내가 다르다. 몸체의 오류 코드를 상태 뒤에 붙여 화면이 가른다. 코드가 없으면 상태만 남긴다.
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof body?.error === 'string' ? `:${body.error}` : '';
    throw new Error(`SHOWCASE_REQUEST_FAILED:${response.status}${code}`);
  }
  const result = showcaseRoomResponseSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new Error('INVALID_RESPONSE');
  return result.data;
}

/**
 * S15P21C204-260. Operator-only demo entry. The address fragment carries the session the demo
 * route already issued; it is consumed and cleared exactly like an invitation, and there is no
 * player-facing way to produce one.
 */
type DemoSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const DEMO_SESSION_KEY = 'kkakkung.demo-session';

/** 이 탭의 sessionStorage. 접근 자체가 던지는 환경(비공개 창 제한 등)에서는 null. */
function browserSessionStorage(): DemoSessionStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 관리자 데모 링크의 세션을 읽는다. 토큰이 주소에 남지 않도록 조각은 곧바로 지운다.
 *
 * S15P21C204-312. 조각을 지우면 브라우저 새로고침(F5)이 토큰 없는 주소로 돌아와 홈으로
 * 떨어졌다. 서버는 끊긴 데모 세션의 좌석을 지켜 두는데 화면이 열쇠를 잃었다. 그래서 이 탭의
 * sessionStorage 에 둔다. 탭을 닫으면 사라지고 다른 탭·기기와 나누지 않는다. 유효한지는 서버가
 * 판정하며, 나가거나 거절되면 `forgetDemoSession` 이 지운다.
 */
export function consumeDemoSession(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
  storage: DemoSessionStorage | null = browserSessionStorage(),
): SessionResponse | null {
  const fragment = readEntryFragment(location, history, 'demo');
  if (fragment === 'invalid') return null;
  let { sessionToken, roomCode, playerId } = fragment ?? {
    sessionToken: '',
    roomCode: '',
    playerId: '',
  };
  if (fragment) {
    try {
      storage?.setItem(DEMO_SESSION_KEY, JSON.stringify({ sessionToken, roomCode, playerId }));
    } catch {
      // 저장하지 못하면 새로고침 재입장만 안 된다. 이번 입장은 그대로 한다.
    }
  } else {
    // 조각이 없으면 이 탭이 앞서 연 데모 세션으로 돌아간다(새로고침).
    let stored: unknown;
    try {
      stored = JSON.parse(storage?.getItem(DEMO_SESSION_KEY) ?? 'null');
    } catch {
      stored = null;
    }
    if (!stored || typeof stored !== 'object') return null;
    const value = stored as Record<string, unknown>;
    sessionToken = typeof value.sessionToken === 'string' ? value.sessionToken : '';
    roomCode = typeof value.roomCode === 'string' ? value.roomCode : '';
    playerId = typeof value.playerId === 'string' ? value.playerId : '';
    if (!sessionToken || !playerId || !ROOM_CODE_PATTERN.test(roomCode)) {
      forgetDemoSession(storage);
      return null;
    }
  }
  return {
    sessionToken,
    playerId,
    roomCode,
    expiresAt: Date.now() + 60_000,
    protocolVersion: PRODUCT_PROTOCOL_VERSION,
  };
}

/**
 * 시연 방 진입. `/showcase` 가 만든 `#showcase=…` 조각을 데모와 같은 방식으로 소비·삭제한다.
 * 데모와 달리 저장하지 않는다: 시연 세션은 일반 경기 세션이라 서버가 끊기면 좌석을 지키지 않고,
 * 다시 들어오려면 `/showcase` 에서 새로 고른다.
 */
export function consumeShowcaseSession(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
): SessionResponse | null {
  const fragment = readEntryFragment(location, history, 'showcase');
  if (!fragment || fragment === 'invalid') return null;
  return { ...fragment, expiresAt: Date.now() + 60_000, protocolVersion: PRODUCT_PROTOCOL_VERSION };
}

/**
 * 주소 조각에서 진입 세션을 읽고 조각을 지운다. 조각이 없으면 null, 있는데 깨졌으면 'invalid'.
 * 토큰이 주소·기록에 남지 않도록 읽는 즉시 replaceState 로 지운다.
 */
function readEntryFragment(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
  key: 'demo' | 'showcase',
): { sessionToken: string; roomCode: string; playerId: string } | null | 'invalid' {
  const params = new URLSearchParams(location.hash.slice(1));
  const sessionToken = params.get(key) ?? '';
  const roomCode = params.get('room') ?? '';
  const playerId = params.get('player') ?? '';
  if (!sessionToken && !playerId) return null;
  if (!sessionToken || !playerId || !ROOM_CODE_PATTERN.test(roomCode)) return 'invalid';
  history.replaceState(null, '', location.pathname + location.search);
  return { sessionToken, roomCode, playerId };
}

/** 나가기·입장 거절 뒤에는 새로고침이 끝난 방으로 돌아가지 않게 지운다. */
export function forgetDemoSession(storage: DemoSessionStorage | null = browserSessionStorage()) {
  try {
    storage?.removeItem(DEMO_SESSION_KEY);
  } catch {
    // 지우지 못해도 서버가 끝난 세션을 거절한다.
  }
}

/**
 * S15P21C204-396. 경기 중 새로고침을 넘어 같은 자리로 돌아가기 위한 기록. 서버는 경기(PLAYING) 중 끊긴
 * 사람의 자리를 25초 비워 두는데(391) 재접속 토큰이 메모리에만 있어 새로고침하면 쓸 수 없었다. 페이지를
 * 떠나는 순간에만 이 탭의 sessionStorage 에 적고, 다음 페이지가 읽자마자 지운다. 적은 뒤 25초가 지났으면
 * 서버 자리도 풀렸으므로 버린다. 미디어 세대는 새 페이지가 이전 세대를 이어받아 교체를 요청하는 데 쓴다.
 */
export type MatchRejoin = Readonly<{
  session: SessionResponse;
  reconnectionToken: string;
  mediaScope: Readonly<{
    matchId: string;
    mediaInstanceId: string;
    receiverGeneration: number;
  }> | null;
  savedAt: number;
}>;
const MATCH_REJOIN_KEY = 'kkakkung.match-rejoin';
export const MATCH_REJOIN_WINDOW_MS = 25_000;

export function rememberMatchRejoin(
  value: Omit<MatchRejoin, 'savedAt'>,
  now = Date.now(),
  storage: DemoSessionStorage | null = browserSessionStorage(),
) {
  try {
    storage?.setItem(MATCH_REJOIN_KEY, JSON.stringify({ ...value, savedAt: now }));
  } catch {
    // 적지 못하면 새로고침 뒤 돌아오지 못할 뿐이다. 서버 유예가 끝나면 전처럼 무효다.
  }
}

export function forgetMatchRejoin(storage: DemoSessionStorage | null = browserSessionStorage()) {
  try {
    storage?.removeItem(MATCH_REJOIN_KEY);
  } catch {
    // 지우지 못해도 25초가 지나면 읽는 쪽이 버린다.
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 이 탭이 방금 떠난 경기로 돌아갈 기록. 읽자마자 지운다. 형식이 틀리거나 25초가 지났으면 null. */
export function consumeMatchRejoin(
  now = Date.now(),
  storage: DemoSessionStorage | null = browserSessionStorage(),
): MatchRejoin | null {
  let stored: unknown;
  try {
    stored = JSON.parse(storage?.getItem(MATCH_REJOIN_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  forgetMatchRejoin(storage);
  if (!isRecord(stored) || !isRecord(stored.session)) return null;
  const session = stored.session;
  const scope = stored.mediaScope;
  if (
    typeof stored.reconnectionToken !== 'string' ||
    stored.reconnectionToken === '' ||
    typeof stored.savedAt !== 'number' ||
    now - stored.savedAt < 0 ||
    now - stored.savedAt >= MATCH_REJOIN_WINDOW_MS ||
    typeof session.sessionToken !== 'string' ||
    typeof session.playerId !== 'string' ||
    typeof session.roomCode !== 'string' ||
    !ROOM_CODE_PATTERN.test(session.roomCode)
  )
    return null;
  const mediaScope =
    isRecord(scope) &&
    typeof scope.matchId === 'string' &&
    typeof scope.mediaInstanceId === 'string' &&
    typeof scope.receiverGeneration === 'number'
      ? {
          matchId: scope.matchId,
          mediaInstanceId: scope.mediaInstanceId,
          receiverGeneration: scope.receiverGeneration,
        }
      : null;
  return {
    session: {
      sessionToken: session.sessionToken,
      playerId: session.playerId,
      roomCode: session.roomCode,
      expiresAt: typeof session.expiresAt === 'number' ? session.expiresAt : now + 60_000,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    },
    reconnectionToken: stored.reconnectionToken,
    mediaScope,
    savedAt: stored.savedAt,
  };
}
