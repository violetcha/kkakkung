import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { expect, it } from 'vitest';
import {
  PRODUCT_CLIENT_MESSAGES,
  PRODUCT_SERVER_MESSAGES,
  sessionResponseSchema,
  type RoomRosterMessage,
} from '@kkakkung/protocol/game-messages';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { INVITATION_ROUTES } from '../../src/session/invite-types.js';
import { bootProductApplication, TEST_OPS_TOKEN } from './test-harness.js';

it('clears device readiness after preparation fails and waits for new READY reports', async () => {
  const app = await bootProductApplication({ layouts: null });
  const rooms: Room<unknown, PublicMatchState>[] = [];
  const rosters: RoomRosterMessage[] = [];
  try {
    const invitation = await fetch(app.endpoint + INVITATION_ROUTES.issue, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_OPS_TOKEN}` },
      body: JSON.stringify({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: Date.now() + 60000,
      }),
    });
    expect(invitation.status).toBe(201);
    const { inviteToken } = (await invitation.json()) as { inviteToken: string };
    const sdk = new Client(app.endpoint);
    let roomCode: string | undefined;
    for (let index = 0; index < 6; index++) {
      const response = await fetch(app.endpoint + '/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nickname: `준비${index}`,
          inviteToken,
          createRoom: !roomCode,
          ...(roomCode ? { roomCode } : {}),
        }),
      });
      expect(response.status).toBe(201);
      const session = sessionResponseSchema.parse(await response.json());
      roomCode = session.roomCode;
      const room = await sdk.joinOrCreate<unknown, PublicMatchState>(PRODUCT_ROOM_NAME, {
        token: session.sessionToken,
        roomCode,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
      });
      room.onMessage(PRODUCT_SERVER_MESSAGES.roomRoster, (roster: RoomRosterMessage) =>
        rosters.push(roster),
      );
      room.onMessage('*', () => undefined);
      rooms.push(room);
    }
    const waitPhase = (phase: string) => expect.poll(() => rooms[0]!.state.phase).toBe(phase);
    const sendAll = (type: 'READY' | 'PRACTICE_READY', sequence: number) => {
      for (const room of rooms)
        room.send(PRODUCT_CLIENT_MESSAGES.command, {
          matchId: room.state.matchId,
          requestId: randomUUID(),
          sequence,
          type,
          payload: { ready: true },
        });
    };
    await waitPhase('DEVICE_CHECK');
    sendAll('READY', 1);
    await waitPhase('TEAM_PRACTICE');
    sendAll('PRACTICE_READY', 2);
    await waitPhase('DEVICE_CHECK');
    await expect.poll(() => rosters.at(-1)?.players.every((player) => !player.ready)).toBe(true);
    const serverRoom = app.application.directory.get(roomCode!) as unknown as {
      tick(): void;
      phase: string;
      blockedReason: string | null;
    };
    expect(serverRoom.blockedReason).toBe('LAYOUT:LAYOUT_PRODUCER_MISSING');
    await expect.poll(() => rooms[0]!.state.preparationIssue).toBe('LAYOUT_UNAVAILABLE');
    expect(JSON.stringify(rooms[0]!.state.toJSON())).not.toContain('LAYOUT_PRODUCER_MISSING');
    for (let index = 0; index < 5; index++) serverRoom.tick();
    expect(serverRoom.phase).toBe('DEVICE_CHECK');
    sendAll('READY', 3);
    await waitPhase('TEAM_PRACTICE');
    await expect.poll(() => rooms[0]!.state.preparationIssue).toBeUndefined();
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await app.application.close();
  }
});
