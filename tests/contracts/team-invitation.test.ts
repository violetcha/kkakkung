import { describe, expect, it, vi } from 'vitest';
import { issueTeamInvitation } from '../../scripts/lib/team-invitation.mjs';
import { INVITATION_ROUTES } from '../../server/src/session/invite-types.js';
import {
  consumeInvitation,
  invitationRoom,
} from '../../apps/web/src/features/room/product-session.js';

const input = () => ({
  baseUrl: 'http://127.0.0.1:8080',
  publicUrl: 'https://team.example',
  opsToken: 'synthetic-operator',
  expiresAt: Date.now() + 60000,
});
describe('private team invitation links', () => {
  it.each([undefined, 'ABCDEF'])(
    'uses the real operator route and consumer contract: %s',
    async (roomCode) => {
      const request = input();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            inviteToken: 'synthetic-token-123456',
            expiresAt: request.expiresAt,
          }),
          { status: 201 },
        ),
      );
      const result = await issueTeamInvitation({ ...request, roomCode }, fetcher);
      expect(fetcher.mock.calls[0]![0]).toBe(request.baseUrl + INVITATION_ROUTES.issue);
      expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).scope).toEqual({
        allowCreate: !roomCode,
        roomCodes: roomCode ? [roomCode] : [],
      });
      const link = new URL(result.url);
      expect(link.search).toBe('');
      expect(invitationRoom(link.hash)).toBe(roomCode ?? '');
      const replaceState = vi.fn();
      expect(consumeInvitation(link, { replaceState })).toBe('synthetic-token-123456');
      expect(replaceState).toHaveBeenCalledWith(null, '', '/play');
    },
  );
  it('rejects remote credential destinations and bad room codes before sending', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const change of [{ baseUrl: 'https://untrusted.example' }, { roomCode: 'INVALID' }])
      await expect(issueTeamInvitation({ ...input(), ...change }, fetcher)).rejects.toThrow(
        'INVITATION_INPUT_INVALID',
      );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not propagate an error body containing secrets', async () => {
    await expect(
      issueTeamInvitation(input(), async () => new Response('secret', { status: 401 })),
    ).rejects.toThrow('INVITATION_REJECTED');
  });
});
