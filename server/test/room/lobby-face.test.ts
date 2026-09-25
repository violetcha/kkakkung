/**
 * S15P21C204-401. 대기실에서 준비한 사람의 가공 얼굴 사진 한 장을 게임 서버가 같은 방에 전한다.
 * 대기실·장치 점검에는 미디어가 없으므로 이 길로만 다른 사람 얼굴을 볼 수 있다.
 */
import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import {
  sessionResponseSchema,
  type LobbyFaceMessage,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import type { Phase, PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { bootProductApplication } from './test-harness.js';

const photo = (fill: string) => 'data:image/jpeg;base64,' + fill.repeat(40) + '==';

async function fixture() {
  const clock = { now: 0 };
  const h = await bootProductApplication({ monotonicNow: () => clock.now });
  const peers: { room: Room<unknown, PublicMatchState>; faces: LobbyFaceMessage[] }[] = [];
  const issue = h.application.invites!.issue({
    scope: { allowCreate: true, roomCodes: [] },
    expiresAt: Date.now() + 600_000,
  });
  if (issue.status !== 'issued') throw new Error(issue.code);
  let roomCode: string | null = null;
  const join = async () => {
    const response = await fetch(h.endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: `friend-${peers.length}`,
        inviteToken: issue.invitation.inviteToken,
        ...(roomCode ? { createRoom: false, roomCode } : { createRoom: true }),
      }),
    });
    expect(response.status).toBe(201);
    const session: SessionResponse = sessionResponseSchema.parse(await response.json());
    roomCode = session.roomCode;
    const room = await new Client(h.endpoint).joinOrCreate<unknown, PublicMatchState>(
      PRODUCT_ROOM_NAME,
      { token: session.sessionToken, roomCode, protocolVersion: PRODUCT_PROTOCOL_VERSION },
    );
    room.reconnection.enabled = false;
    room.onMessage('*', () => undefined);
    const peer = { room, faces: [] as LobbyFaceMessage[], playerId: session.playerId };
    room.onMessage('lobby-face', (value: LobbyFaceMessage) => peer.faces.push(value));
    peers.push(peer);
    await vi.waitFor(() => expect(room.state.matchId).toBeTruthy());
    return peer;
  };
  const serverRoom = () =>
    h.application.directory.get(roomCode!) as unknown as { setPhase(phase: Phase): void };
  return {
    clock,
    join,
    serverRoom,
    close: async () => {
      await Promise.all(
        peers.map((p) => (p.room.connection.isOpen ? p.room.leave() : Promise.resolve())),
      );
      await h.application.close();
    },
  };
}

it('passes a lobby face to the others, to late joiners, and clears it when its owner leaves', async () => {
  const f = await fixture();
  try {
    const a = await f.join();
    const b = await f.join();
    a.room.send('lobby-face', { image: photo('A') });
    await vi.waitFor(() => expect(b.faces).toEqual([{ playerId: a.playerId, image: photo('A') }]));
    // 보낸 사람에게는 되돌려 보내지 않는다. 자기 얼굴은 자기 기기에서 그린다.
    expect(a.faces).toEqual([]);

    // 늦게 들어온 사람은 받을 준비를 마친 뒤 달라고 하고, 그러면 이미 올라온 사진을 받는다.
    const c = await f.join();
    expect(c.faces).toEqual([]);
    c.room.send('lobby-face-sync', {});
    await vi.waitFor(() => expect(c.faces).toEqual([{ playerId: a.playerId, image: photo('A') }]));

    // 2초 안에 다시 보낸 것과 형식이 틀린 것은 버린다.
    a.room.send('lobby-face', { image: photo('B') });
    b.room.send('lobby-face', { image: 'data:image/png;base64,AAAA' });
    // 서버가 위 두 개를 받을 때까지 시계를 그대로 둔다. 버린 것은 알려 오지 않으므로 잠깐 기다린다.
    await new Promise((resolve) => setTimeout(resolve, 200));
    f.clock.now = 2_000;
    a.room.send('lobby-face', { image: photo('C') });
    await vi.waitFor(() =>
      expect(c.faces.at(-1)).toEqual({ playerId: a.playerId, image: photo('C') }),
    );
    expect(b.faces.map((face) => face.image)).toEqual([photo('A'), photo('C')]);

    // 나가면 남은 사람들에게서 지운다.
    await a.room.leave();
    await vi.waitFor(() => expect(b.faces.at(-1)).toEqual({ playerId: a.playerId, image: null }));
    await vi.waitFor(() => expect(c.faces.at(-1)).toEqual({ playerId: a.playerId, image: null }));
  } finally {
    await f.close();
  }
});

it('takes lobby faces only while waiting in the lobby or at the device check', async () => {
  const f = await fixture();
  try {
    const a = await f.join();
    const b = await f.join();
    f.serverRoom().setPhase('TEAM_PRACTICE');
    a.room.send('lobby-face', { image: photo('A') });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(b.faces).toEqual([]);
  } finally {
    await f.close();
  }
});
