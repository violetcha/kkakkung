import { describe, expect, it, vi } from 'vitest';
import {
  cancelSessionReservation,
  consumeInvitation,
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
