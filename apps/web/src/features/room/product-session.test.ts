import { describe, expect, it, vi } from 'vitest';
import { consumeInvitation, requestSession } from './product-session';
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
});
