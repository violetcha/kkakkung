import { describe, expect, it } from 'vitest';

import {
  roomRosterSchema,
  roomAccessSchema,
  ROOM_REMOVED_CLOSE_CODE,
} from '../src/game-messages/room.js';
import {
  sessionRequestSchema,
  sessionResponseSchema,
  productJoinOptionsSchema,
} from '../src/game-messages/session.js';

describe('room roster and session contracts', () => {
  it('exposes only the room access revision and lock without player authority fields', () => {
    const value = { matchId: 'm', revision: 1, locked: true };
    expect(roomAccessSchema.parse(value)).toEqual(value);
    expect(ROOM_REMOVED_CLOSE_CODE).toBe(4002);
    for (const invalid of [
      { ...value, revision: -1 },
      { ...value, revision: 0.5 },
      { ...value, hostId: 'p' },
    ])
      expect(roomAccessSchema.safeParse(invalid).success).toBe(false);
  });
  it('carries readiness and connection only, never roles or coordinates', () => {
    const roster = {
      matchId: 'm',
      stateVersion: 2,
      phase: 'DEVICE_CHECK',
      hostId: 'p1',
      players: [{ playerId: 'p1', nickname: '하나', ready: true, connected: true }],
    };
    expect(roomRosterSchema.parse(roster)).toEqual(roster);
    expect(
      roomRosterSchema.safeParse({ ...roster, players: [{ ...roster.players[0], role: 'tagger' }] })
        .success,
    ).toBe(false);
    expect(
      roomRosterSchema.safeParse({ ...roster, players: [{ ...roster.players[0], x: 1 }] }).success,
    ).toBe(false);
    expect(roomRosterSchema.safeParse({ ...roster, phase: 'waiting' }).success).toBe(false);
    expect(
      roomRosterSchema.safeParse({ ...roster, players: Array(7).fill(roster.players[0]) }).success,
    ).toBe(false);
  });

  it('splits session creation and joining as a strict discriminated union', () => {
    // Absence is allowed on the wire; only the server can authorize trusted SSO admission.
    expect(sessionRequestSchema.parse({ nickname: '팀원', createRoom: true })).toBeTruthy();
    expect(
      sessionRequestSchema.parse({ nickname: '팀원', createRoom: false, roomCode: 'ABC234' }),
    ).toBeTruthy();
    const invite = 'invite-token-of-sufficient-length';
    expect(
      sessionRequestSchema.parse({ nickname: '하나', inviteToken: invite, createRoom: true }),
    ).toBeTruthy();
    expect(
      sessionRequestSchema.parse({
        nickname: '하나',
        inviteToken: invite,
        createRoom: false,
        roomCode: 'ABC234',
      }),
    ).toBeTruthy();
    expect(
      sessionRequestSchema.safeParse({
        nickname: '하나',
        inviteToken: invite,
        createRoom: true,
        roomCode: 'ABC234',
      }).success,
    ).toBe(false);
    expect(
      sessionRequestSchema.safeParse({ nickname: '하나', inviteToken: invite, createRoom: false })
        .success,
    ).toBe(false);
    expect(
      sessionRequestSchema.safeParse({ nickname: '', inviteToken: invite, createRoom: true })
        .success,
    ).toBe(false);
    expect(
      sessionRequestSchema.safeParse({ nickname: '하나', inviteToken: 'short', createRoom: true })
        .success,
    ).toBe(false);
    expect(
      sessionRequestSchema.safeParse({
        nickname: '하나',
        inviteToken: invite,
        createRoom: false,
        roomCode: 'abc123',
      }).success,
    ).toBe(false);
    const response = {
      sessionToken: 't',
      playerId: 'p',
      roomCode: 'ABC234',
      expiresAt: 1_900_000_000_000,
      protocolVersion: '0.2.0',
    };
    expect(sessionResponseSchema.parse(response)).toEqual(response);
    expect(sessionResponseSchema.safeParse({ ...response, protocolVersion: '0.1.0' }).success).toBe(
      false,
    );
    expect(
      productJoinOptionsSchema.safeParse({
        token: 't',
        roomCode: 'ABC234',
        protocolVersion: '0.2.0',
      }).success,
    ).toBe(true);
    expect(
      productJoinOptionsSchema.safeParse({ token: 't', protocolVersion: '0.2.0' }).success,
    ).toBe(false);
  });
});
