import { Client } from '@colyseus/sdk';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import {
  DEMO_ADMIN_ROOM_ROUTE,
  demoRoomRequestSchema,
  demoRoomResponseSchema,
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
  if (!response.ok) throw new Error(`DEMO_REQUEST_FAILED:${response.status}`);
  const result = demoRoomResponseSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new Error('INVALID_RESPONSE');
  return result.data;
}

export function joinProductRoom(session: SessionResponse) {
  const configured = (import.meta.env.VITE_COLYSEUS_URL as string | undefined)?.trim();
  const url = configured || (import.meta.env.DEV ? 'ws://127.0.0.1:2567' : window.location.origin);
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

export function productRoomPort(room: Room<unknown, PublicMatchState>): ProductRoomPort {
  room.reconnection.enabled = false;
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
    onLeave(handler) {
      room.onLeave(handler);
      room.onDrop(handler);
      return () => {
        room.onLeave.remove(handler);
        room.onDrop.remove(handler);
      };
    },
    onError(handler) {
      room.onError(handler);
      return () => room.onError.remove(handler);
    },
    leave: () => (room.connection.isOpen ? room.leave() : Promise.resolve()),
  };
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
  const params = new URLSearchParams(location.hash.slice(1));
  let sessionToken = params.get('demo') ?? '';
  let roomCode = params.get('room') ?? '';
  let playerId = params.get('player') ?? '';
  if (sessionToken || playerId) {
    if (!sessionToken || !playerId || !ROOM_CODE_PATTERN.test(roomCode)) return null;
    history.replaceState(null, '', location.pathname + location.search);
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

/** 나가기·입장 거절 뒤에는 새로고침이 끝난 방으로 돌아가지 않게 지운다. */
export function forgetDemoSession(storage: DemoSessionStorage | null = browserSessionStorage()) {
  try {
    storage?.removeItem(DEMO_SESSION_KEY);
  } catch {
    // 지우지 못해도 서버가 끝난 세션을 거절한다.
  }
}
