import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { expect, it, vi } from 'vitest';
import {
  ROOM_REMOVED_CLOSE_CODE,
  sessionResponseSchema,
  type CommandEnvelope,
  type CommandOutcome,
  type CommandReceipt,
  type RoomMapMessage,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import type { Phase, PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { bootProductApplication } from './test-harness.js';

async function fixture() {
  const h = await bootProductApplication({ monotonicNow: () => 0 });
  const peers: {
    room: Room<unknown, PublicMatchState>;
    session: SessionResponse;
    sequence: number;
  }[] = [];
  const issue = h.application.invites!.issue({
    scope: { allowCreate: true, roomCodes: [] },
    expiresAt: Date.now() + 600_000,
  });
  if (issue.status !== 'issued') throw new Error(issue.code);
  const reserve = () =>
    fetch(h.endpoint + '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: `friend-${peers.length}`,
        inviteToken: issue.invitation.inviteToken,
        ...(peers[0]
          ? { createRoom: false, roomCode: peers[0].session.roomCode }
          : { createRoom: true }),
      }),
    });
  const connect = async (session: SessionResponse) => {
    const room = await new Client(h.endpoint).joinOrCreate<unknown, PublicMatchState>(
      PRODUCT_ROOM_NAME,
      {
        token: session.sessionToken,
        roomCode: session.roomCode,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
      },
    );
    room.reconnection.enabled = false;
    room.onMessage('*', () => undefined);
    const peer = { room, session, sequence: 0 };
    peers.push(peer);
    return peer;
  };
  const join = async () => {
    const response = await reserve();
    expect(response.status).toBe(201);
    return connect(sessionResponseSchema.parse(await response.json()));
  };
  const host = await join();
  const serverRoom = h.application.directory.get(host.session.roomCode) as unknown as {
    roomId: string;
    state: PublicMatchState;
    tick(): void;
    setPhase(phase: Phase): void;
  };
  h.application.coordinator.unregister(serverRoom.roomId);
  await vi.waitFor(() => expect(host.room.state.matchId).toBeTruthy());
  const send = async (
    peer: typeof host,
    input: Pick<CommandEnvelope, 'type' | 'payload'>,
    options: { tick?: boolean; command?: CommandEnvelope } = {},
  ) => {
    const command = options.command ?? {
      matchId: host.room.state.matchId,
      requestId: randomUUID(),
      sequence: ++peer.sequence,
      ...input,
    };
    let receipt: CommandReceipt | undefined;
    let outcome: CommandOutcome | undefined;
    const offReceipt = peer.room.onMessage('command-result', (value: CommandReceipt) => {
      if (value.requestId === command.requestId) receipt = value;
    });
    const offOutcome = peer.room.onMessage('command-outcome', (value: CommandOutcome) => {
      if (value.requestId === command.requestId) outcome = value;
    });
    peer.room.send('command', command);
    await vi.waitFor(() => expect(receipt).toBeDefined());
    if (receipt?.status === 'accepted' && options.tick !== false) {
      serverRoom.tick();
      await vi.waitFor(() => expect(outcome).toBeDefined());
    }
    offReceipt();
    offOutcome();
    return { receipt: receipt!, outcome, command: command as CommandEnvelope };
  };
  return {
    ...h,
    host,
    peers,
    reserve,
    connect,
    join,
    serverRoom,
    send,
    close: async () => {
      await Promise.all(
        peers.map((p) => (p.room.connection.isOpen ? p.room.leave() : Promise.resolve())),
      );
      await h.application.close();
    },
  };
}

it('locks both new reservations and already issued sessions, reopens and replays a command once', async () => {
  const f = await fixture();
  try {
    const friend = await f.join();
    const reserved = sessionResponseSchema.parse(await (await f.reserve()).json());
    expect(
      (await f.send(friend, { type: 'ROOM_LOCK', payload: { locked: true } })).receipt.code,
    ).toBe('NOT_ALLOWED');
    const lock = await f.send(f.host, { type: 'ROOM_LOCK', payload: { locked: true } });
    expect(lock.outcome?.result).toBe('applied');
    expect(f.application.productSessions.authenticate(reserved.sessionToken)).toBeNull();
    const denied = await f.reserve();
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ error: 'ROOM_NOT_AVAILABLE' });
    await expect(f.connect(reserved)).rejects.toThrow();
    const slots = f.application.slots!;
    expect(slots.occupied(f.host.session.roomCode)).toBe(2);
    expect(
      (
        await f.send(
          f.host,
          { type: 'ROOM_LOCK', payload: { locked: true } },
          { command: lock.command },
        )
      ).outcome,
    ).toEqual(lock.outcome);
    expect(slots.access(f.host.session.roomCode)).toEqual({ locked: true, revision: 1 });
    expect(
      (await f.send(f.host, { type: 'ROOM_LOCK', payload: { locked: false } })).outcome?.result,
    ).toBe('applied');
    await f.join();
    expect(slots.occupied(f.host.session.roomCode)).toBe(3);
  } finally {
    await f.close();
  }
});

it.each([2, 6])(
  'removes another participant with %i players, invalidates the session and locks re-entry',
  async (count) => {
    const f = await fixture();
    try {
      const friend = await f.join();
      for (let i = 2; i < count; i++) await f.join();
      const closed = vi.fn();
      friend.room.onLeave(closed);
      for (const targetPlayerId of [f.host.session.playerId, 'foreign-player']) {
        expect(
          (await f.send(f.host, { type: 'ROOM_KICK', payload: { targetPlayerId } })).outcome?.code,
        ).toBe('NOT_ALLOWED');
      }
      const result = await f.send(f.host, {
        type: 'ROOM_KICK',
        payload: { targetPlayerId: friend.session.playerId },
      });
      expect(result.outcome?.result).toBe('applied');
      await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
      expect(closed.mock.calls[0]?.[0]).toBe(ROOM_REMOVED_CLOSE_CODE);
      expect(f.application.productSessions.authenticate(friend.session.sessionToken)).toBeNull();
      expect(f.application.slots!.occupied(f.host.session.roomCode)).toBe(count - 1);
      expect((await f.reserve()).status).toBe(404);
      await expect(f.connect(friend.session)).rejects.toThrow();
    } finally {
      await f.close();
    }
  },
);

it('delegates controls when the host leaves and rechecks phase after command acceptance', async () => {
  const f = await fixture();
  try {
    const next = await f.join();
    await f.host.room.leave();
    await vi.waitFor(() => expect(f.application.slots!.occupied(next.session.roomCode)).toBe(1));
    expect(
      (await f.send(next, { type: 'ROOM_LOCK', payload: { locked: true } })).outcome?.result,
    ).toBe('applied');
    // The connection state still identifies the same match after host departure.
    const accepted = await f.send(
      next,
      { type: 'ROOM_LOCK', payload: { locked: false } },
      { tick: false },
    );
    expect(accepted.receipt.status).toBe('accepted');
    f.serverRoom.setPhase('PLAYING');
    const outcomes = vi.fn();
    next.room.onMessage('command-outcome', outcomes);
    f.serverRoom.tick();
    await vi.waitFor(() => expect(outcomes).toHaveBeenCalled());
    expect(outcomes.mock.calls[0]?.[0]).toMatchObject({
      requestId: accepted.command.requestId,
      result: 'rejected',
      code: 'INVALID_PHASE',
    });
    expect(f.application.slots!.access(next.session.roomCode)?.locked).toBe(true);
    expect(
      (await f.send(next, { type: 'ROOM_KICK', payload: { targetPlayerId: 'any' } })).receipt.code,
    ).toBe('INVALID_PHASE');
  } finally {
    await f.close();
  }
});

it('delivers new-match roster and access after its public patch on a real rematch connection', async () => {
  const f = await fixture();
  try {
    await f.join();
    await f.send(f.host, { type: 'ROOM_LOCK', payload: { locked: true } });
    const oldMatchId = f.host.room.state.matchId;
    const observations: { channel: string; matchId: string; current: string; locked?: boolean }[] =
      [];
    for (const channel of ['room-roster', 'room-access']) {
      f.host.room.onMessage(channel, (value: { matchId: string; locked?: boolean }) => {
        observations.push({
          channel,
          matchId: value.matchId,
          current: f.host.room.state.matchId,
          locked: value.locked,
        });
      });
    }
    f.serverRoom.setPhase('RESULT');
    await vi.waitFor(() => expect(f.host.room.state.phase).toBe('RESULT'));
    expect(
      (await f.send(f.host, { type: 'REMATCH', payload: { mode: 'lobby' } })).outcome?.result,
    ).toBe('applied');
    await vi.waitFor(() => expect(f.host.room.state.matchId).not.toBe(oldMatchId));
    await vi.waitFor(() =>
      expect(observations.filter((o) => o.matchId !== oldMatchId).map((o) => o.channel)).toEqual([
        'room-access',
        'room-roster',
      ]),
    );
    expect(observations.every((o) => o.current === o.matchId)).toBe(true);
    expect(
      observations.find((o) => o.matchId !== oldMatchId && o.channel === 'room-access')?.locked,
    ).toBe(true);
  } finally {
    await f.close();
  }
});

// S15P21C204-311. 맵 크기는 방장만, 그리고 아직 모으는 중일 때만 바꾼다. 참가자도 같은 값을 본다.
it('lets only the host change the map size while the room is still gathering', async () => {
  const f = await fixture();
  try {
    const friend = await f.join();
    const seen: RoomMapMessage[] = [];
    friend.room.onMessage('room-map', (value: RoomMapMessage) => void seen.push(value));
    expect(
      (await f.send(friend, { type: 'ROOM_MAP_SIZE', payload: { size: 'small' } })).receipt.code,
    ).toBe('NOT_ALLOWED');
    const applied = await f.send(f.host, { type: 'ROOM_MAP_SIZE', payload: { size: 'small' } });
    expect(applied.outcome?.result).toBe('applied');
    await vi.waitFor(() => expect(seen.at(-1)?.size).toBe('small'));
    const revision = seen.at(-1)!.revision;
    // 같은 값을 다시 고르면 판이 올라가지 않는다.
    expect(
      (await f.send(f.host, { type: 'ROOM_MAP_SIZE', payload: { size: 'small' } })).outcome?.result,
    ).toBe('applied');
    await vi.waitFor(() => expect(seen.at(-1)?.size).toBe('small'));
    expect(seen.at(-1)!.revision).toBe(revision);
    // S15P21C204-295. 시작은 방장이 누른다. 그 전까지는 장치 점검에서도 맵을 바꿀 수 있다.
    f.serverRoom.setPhase('DEVICE_CHECK');
    expect(
      (await f.send(f.host, { type: 'ROOM_MAP_SIZE', payload: { size: 'large' } })).outcome?.result,
    ).toBe('applied');
    await vi.waitFor(() => expect(seen.at(-1)?.size).toBe('large'));
    // 경기가 시작되면 더는 못 바꾼다.
    f.serverRoom.setPhase('TEAM_PRACTICE');
    expect(
      (await f.send(f.host, { type: 'ROOM_MAP_SIZE', payload: { size: 'small' } })).receipt.code,
    ).toBe('INVALID_PHASE');
  } finally {
    await f.close();
  }
});
