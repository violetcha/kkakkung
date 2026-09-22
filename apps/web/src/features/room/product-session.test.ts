import { describe, expect, it, vi } from 'vitest';
import {
  cancelSessionReservation,
  consumeDemoSession,
  consumeInvitation,
  forgetDemoSession,
  requestDemoRoom,
  requestSession,
} from './product-session';
describe('product admission', () => {
  it('removes the fragment immediately and stores nothing persistently', () => {
    const replaceState = vi.fn();
    expect(
      consumeInvitation(
        { hash: '#invite=secret', pathname: '/', search: '?room=A' },
        { replaceState },
      ),
    ).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?room=A');
  });
  it('serializes create and join strictly and uses the returned player identity', async () => {
    const response = {
      sessionToken: 'session',
      playerId: 'player-not-socket',
      roomCode: 'ABCDEF',
      expiresAt: 1900000000000,
      protocolVersion: '0.2.0',
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response)));
    const base = { nickname: '산이', inviteToken: 'a'.repeat(16) };
    expect(await requestSession({ ...base, createRoom: true }, fetcher)).toEqual(response);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).not.toHaveProperty('roomCode');
    await requestSession({ ...base, createRoom: false, roomCode: 'ABCDEF' }, fetcher);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).roomCode).toBe('ABCDEF');
  });
  it('never propagates server messages or bearer contents into errors', async () => {
    await expect(
      requestSession(
        { nickname: '산이', inviteToken: 'a'.repeat(16), createRoom: true },
        async () => new Response(JSON.stringify({ error: 'secret-token' }), { status: 403 }),
      ),
    ).rejects.toThrow('CONNECTION_FAILED');
  });
  it('cancels only the owner reservation without putting identity in the URL or body', async () => {
    const session = {
      sessionToken: 'synthetic-owner-token',
      playerId: 'player',
      roomCode: 'ABCDEF',
      expiresAt: 1900000000000,
      protocolVersion: '0.2.0' as const,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await cancelSessionReservation(session, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/sessions/current',
      expect.objectContaining({
        method: 'DELETE',
        headers: { authorization: 'Bearer synthetic-owner-token' },
        cache: 'no-store',
        keepalive: true,
        redirect: 'error',
      }),
    );
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('body');
    fetcher.mockRejectedValue(new Error('network lost'));
    await expect(cancelSessionReservation(session, fetcher)).resolves.toBeUndefined();
  });
  it('uses the SSO-protected administrator endpoint without an operations Bearer', async () => {
    const response = {
      sessionToken: 'demo-session',
      playerId: 'operator',
      roomCode: 'ABCDEF',
      role: 'runner',
      expiresAt: 1900000000000,
      protocolVersion: '0.2.0',
      entryFragment: '#demo=demo-session&room=ABCDEF&player=operator',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response)));
    await expect(requestDemoRoom({ role: 'runner', nickname: '관리자' }, fetcher)).resolves.toEqual(
      response,
    );
    expect(fetcher).toHaveBeenCalledWith(
      '/api/demo-admin/rooms',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
    const init = fetcher.mock.calls[0]![1]!;
    expect(init.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(String(init.body))).toEqual({ role: 'runner', nickname: '관리자' });
  });
});

// S15P21C204-312. 조각은 곧바로 지우므로, 새로고침(F5)은 이 탭에 남긴 세션으로 돌아와야 한다.
describe('demo link across a refresh', () => {
  const memory = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  };
  const history = () => ({ replaceState: vi.fn() });
  const link = {
    hash: '#demo=token-1&room=ABCDEF&player=player-1',
    pathname: '/play',
    search: '',
  };

  it('clears the fragment and comes back to the same session after a refresh', () => {
    const storage = memory();
    const first = history();
    expect(consumeDemoSession(link, first, storage)?.sessionToken).toBe('token-1');
    expect(first.replaceState).toHaveBeenCalledWith(null, '', '/play');
    // 새로고침한 주소에는 토큰이 없다.
    const again = consumeDemoSession({ ...link, hash: '' }, history(), storage);
    expect(again).toMatchObject({
      sessionToken: 'token-1',
      roomCode: 'ABCDEF',
      playerId: 'player-1',
    });
  });

  it('forgets the session when the operator leaves, so a refresh goes home', () => {
    const storage = memory();
    consumeDemoSession(link, history(), storage);
    forgetDemoSession(storage);
    expect(consumeDemoSession({ ...link, hash: '' }, history(), storage)).toBeNull();
  });

  it('ignores a damaged stored value and removes it', () => {
    const storage = memory();
    storage.setItem('kkakkung.demo-session', '{"sessionToken":"t","roomCode":"bad"}');
    expect(consumeDemoSession({ ...link, hash: '' }, history(), storage)).toBeNull();
    expect(storage.getItem('kkakkung.demo-session')).toBeNull();
  });
});

// S15P21C204-312. 503 은 "다른 데모 방이 열려 있음"과 "서비스가 참"을 함께 뜻한다. 코드를 붙여 넘긴다.
it('keeps the server reason when the demo room cannot be opened', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: 'DEMO_ROOM_LIMIT' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  );
  await expect(
    requestDemoRoom({ role: 'runner' }, fetcher as unknown as typeof fetch),
  ).rejects.toThrow('DEMO_REQUEST_FAILED:503:DEMO_ROOM_LIMIT');
});
