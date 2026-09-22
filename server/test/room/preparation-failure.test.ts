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
    // 명령 번호는 사람마다 계속 커져야 한다. 한 통에서 뽑아 쓴다.
    let sequence = 0;
    const sendAll = (type: 'READY' | 'PRACTICE_READY') => {
      const next = ++sequence;
      for (const room of rooms)
        room.send(PRODUCT_CLIENT_MESSAGES.command, {
          matchId: room.state.matchId,
          requestId: randomUUID(),
          sequence: next,
          type,
          payload: { ready: true },
        });
    };
    // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작한다. 준비 보고가
    // 아직 다 적용되기 전이면 거절되므로 단계가 바뀔 때까지 다시 누른다.
    const start = () =>
      expect
        .poll(() => {
          rooms[0]!.send(PRODUCT_CLIENT_MESSAGES.command, {
            matchId: rooms[0]!.state.matchId,
            requestId: randomUUID(),
            sequence: ++sequence,
            type: 'ROOM_START',
            payload: {},
          });
          return rooms[0]!.state.phase;
        })
        .toBe('TEAM_PRACTICE');
    await waitPhase('DEVICE_CHECK');
    sendAll('READY');
    await start();
    sendAll('PRACTICE_READY');
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
    sendAll('READY');
    await start();
    await expect.poll(() => rooms[0]!.state.preparationIssue).toBeUndefined();
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await app.application.close();
  }
});
