import { describe, expect, it } from 'vitest';

import {
  roomRosterSchema,
  roomAccessSchema,
  ROOM_REMOVED_CLOSE_CODE,
  LOBBY_FACE_MAX_CHARS,
  lobbyFaceMessageSchema,
  lobbyFaceUploadSchema,
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

// S15P21C204-401. 대기실 얼굴 사진은 작은 JPEG 데이터 주소 한 장만 받는다.
describe('lobby face', () => {
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(100) + '==';
  it('accepts one small JPEG and refuses anything else', () => {
    expect(lobbyFaceUploadSchema.safeParse({ image }).success).toBe(true);
    for (const bad of [
      'data:image/png;base64,AAAA',
      'https://example.com/face.jpg',
      'data:image/jpeg;base64,<script>',
      'data:image/jpeg;base64,' + 'A'.repeat(LOBBY_FACE_MAX_CHARS),
    ])
      expect(lobbyFaceUploadSchema.safeParse({ image: bad }).success).toBe(false);
    expect(lobbyFaceUploadSchema.safeParse({ image, extra: 1 }).success).toBe(false);
  });

  it('carries a photo or its removal to the others', () => {
    expect(lobbyFaceMessageSchema.safeParse({ playerId: 'p1', image }).success).toBe(true);
    expect(lobbyFaceMessageSchema.safeParse({ playerId: 'p1', image: null }).success).toBe(true);
    expect(lobbyFaceMessageSchema.safeParse({ playerId: '', image: null }).success).toBe(false);
  });
});
