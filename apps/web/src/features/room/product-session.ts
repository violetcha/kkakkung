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
  if (!response.ok) throw new Error(`SHOWCASE_REQUEST_FAILED:${response.status}`);
  const result = showcaseRoomResponseSchema.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new Error('INVALID_RESPONSE');
  return result.data;
}

/**
 * S15P21C204-260. Operator-only demo entry. The address fragment carries the session the demo
 * route already issued; it is consumed and cleared exactly like an invitation, and there is no
 * player-facing way to produce one.
 */
export function consumeDemoSession(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
): SessionResponse | null {
  return consumeEntrySession(location, history, 'demo');
}

/** 시연 방 진입. `/showcase` 가 만든 `#showcase=…` 조각을 데모와 같은 방식으로 소비·삭제한다. */
export function consumeShowcaseSession(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
): SessionResponse | null {
  return consumeEntrySession(location, history, 'showcase');
}

function consumeEntrySession(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
  key: 'demo' | 'showcase',
): SessionResponse | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const sessionToken = params.get(key) ?? '';
  const roomCode = params.get('room') ?? '';
  const playerId = params.get('player') ?? '';
  if (!sessionToken || !playerId || !ROOM_CODE_PATTERN.test(roomCode)) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return {
    sessionToken,
    playerId,
    roomCode,
    expiresAt: Date.now() + 60_000,
    protocolVersion: PRODUCT_PROTOCOL_VERSION,
  };
}
