import { describe, expect, it } from 'vitest';
import { InviteStore } from '../../src/session/InviteStore.js';

function store(overrides: Partial<ConstructorParameters<typeof InviteStore>[0]> = {}) {
  let now = 1_000_000;
  const rooms = new Set(['ABC234']);
  let ready = true;
  const invites = new InviteStore({
    now: () => now,
    maxTtlMs: 60_000,
    publicWindow: { opensAtEpochMs: 900_000, closesAtEpochMs: 2_000_000 },
    knownRoomCodes: () => rooms,
    operationsReady: () => ready,
    ...overrides,
  });
  return {
    invites,
    rooms,
    advance: (ms: number) => (now += ms),
    setReady: (value: boolean) => (ready = value),
    now: () => now,
  };
}

describe('InviteStore', () => {
  it('issues a high-entropy token distinct from room codes and verifies scope', () => {
    const h = store();
    const issued = h.invites.issue({
      scope: { allowCreate: false, roomCodes: ['ABC234'] },
      expiresAt: h.now() + 30_000,
    });
    expect(issued.status).toBe('issued');
    if (issued.status !== 'issued') return;
    const { inviteToken, inviteId } = issued.invitation;
    expect(inviteToken).not.toMatch(/^[A-Z0-9]{6}$/);
    expect(inviteToken.length).toBeGreaterThanOrEqual(40);
    expect(h.invites.verify({ inviteToken, createRoom: false, roomCode: 'ABC234' })).toEqual({
      inviteId,
    });
    expect(h.invites.verify({ inviteToken, createRoom: true })).toBeNull();
    expect(h.invites.verify({ inviteToken, createRoom: false, roomCode: 'ZZZ999' })).toBeNull();
    expect(
      h.invites.verify({ inviteToken: 'ABC234', createRoom: false, roomCode: 'ABC234' }),
    ).toBeNull();
    expect(
      h.invites.verify({
        inviteToken: inviteToken.slice(0, -1) + (inviteToken.endsWith('A') ? 'B' : 'A'),
        createRoom: false,
        roomCode: 'ABC234',
      }),
    ).toBeNull();
    // Metadata never contains the raw token.
    expect(JSON.stringify(h.invites.describe(inviteId))).not.toContain(inviteToken);
  });

  it('binds rooms created through an invitation and refuses other invitations by room code alone', () => {
    const h = store();
    const creator = h.invites.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: h.now() + 30_000,
    });
    const other = h.invites.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: h.now() + 30_000,
    });
    if (creator.status !== 'issued' || other.status !== 'issued')
      throw new Error('expected issued');
    const created = h.invites.verify({
      inviteToken: creator.invitation.inviteToken,
      createRoom: true,
    });
    expect(created).toEqual({ inviteId: creator.invitation.inviteId });
    h.invites.bindCreatedRoom(creator.invitation.inviteId, 'NEW234');
    expect(
      h.invites.verify({
        inviteToken: creator.invitation.inviteToken,
        createRoom: false,
        roomCode: 'NEW234',
      }),
    ).toBeTruthy();
    expect(
      h.invites.verify({
        inviteToken: other.invitation.inviteToken,
        createRoom: false,
        roomCode: 'NEW234',
      }),
    ).toBeNull();
    h.invites.forgetRoom('NEW234');
    expect(
      h.invites.verify({
        inviteToken: creator.invitation.inviteToken,
        createRoom: false,
        roomCode: 'NEW234',
      }),
    ).toBeNull();
  });

  it('treats revoked and expired (boundary) tokens identically and keeps revoke idempotent', () => {
    const h = store();
    const issued = h.invites.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: h.now() + 10_000,
    });
    if (issued.status !== 'issued') throw new Error('expected issued');
    const { inviteToken, inviteId } = issued.invitation;
    h.advance(10_000);
    expect(h.invites.verify({ inviteToken, createRoom: true })).toBeNull();
    const fresh = h.invites.issue({
      scope: { allowCreate: true, roomCodes: [] },
      expiresAt: h.now() + 10_000,
    });
    if (fresh.status !== 'issued') throw new Error('expected issued');
    h.invites.revoke(fresh.invitation.inviteId);
    h.invites.revoke(fresh.invitation.inviteId);
    h.invites.revoke('missing');
    expect(
      h.invites.verify({ inviteToken: fresh.invitation.inviteToken, createRoom: true }),
    ).toBeNull();
    expect(h.invites.describe(inviteId)?.revoked).toBe(false);
  });

  it('rejects issuance outside the public window, over the max TTL, with unknown rooms or when not ready', () => {
    const h = store();
    const now = h.now();
    expect(
      h.invites.issue({ scope: { allowCreate: true, roomCodes: [] }, expiresAt: now + 60_001 }),
    ).toEqual({ status: 'rejected', code: 'INVALID_INVITATION' });
    expect(
      h.invites.issue({ scope: { allowCreate: true, roomCodes: [] }, expiresAt: now }),
    ).toEqual({ status: 'rejected', code: 'INVALID_INVITATION' });
    expect(
      h.invites.issue({ scope: { allowCreate: false, roomCodes: [] }, expiresAt: now + 1000 }),
    ).toEqual({ status: 'rejected', code: 'INVALID_INVITATION' });
    expect(
      h.invites.issue({
        scope: { allowCreate: false, roomCodes: ['ZZZ999'] },
        expiresAt: now + 1000,
      }),
    ).toEqual({ status: 'rejected', code: 'INVALID_INVITATION' });
    expect(
      h.invites.issue({
        scope: { allowCreate: false, roomCodes: ['ABC234', 'ABC234'] },
        expiresAt: now + 1000,
      }),
    ).toEqual({ status: 'rejected', code: 'INVALID_INVITATION' });
    expect(
      h.invites.issue({ scope: { allowCreate: true, roomCodes: [] }, expiresAt: 2_000_001 }),
    ).toEqual({ status: 'rejected', code: 'OUTSIDE_PUBLIC_WINDOW' });
    h.setReady(false);
    expect(
      h.invites.issue({ scope: { allowCreate: true, roomCodes: [] }, expiresAt: now + 1000 }),
    ).toEqual({ status: 'rejected', code: 'NOT_READY' });
    const locked = store({ publicWindow: null });
    expect(
      locked.invites.issue({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: locked.now() + 1000,
      }),
    ).toEqual({ status: 'rejected', code: 'OUTSIDE_PUBLIC_WINDOW' });
    const unconfigured = store({ maxTtlMs: null });
    expect(
      unconfigured.invites.issue({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: unconfigured.now() + 1000,
      }),
    ).toEqual({ status: 'rejected', code: 'NOT_READY' });
  });
});
