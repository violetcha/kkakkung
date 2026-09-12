import { Client } from '@colyseus/sdk';
import { PRODUCT_PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import {
  sessionRequestSchema,
  sessionResponseSchema,
  SESSION_ERROR_CODES,
  SESSION_CANCEL_ROUTE,
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
