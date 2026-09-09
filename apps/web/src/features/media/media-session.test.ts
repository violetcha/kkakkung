import { describe, expect, it, vi } from 'vitest';

import { createMediaSession, MediaConnectionError, type MediaSessionDeps } from './media-session';
import { ROOM_EVENTS, type MediaGrant, type MediaRoomPort, type MediaStatus } from './media-types';

const NOW_SECONDS = 1_800_000_000;

const grant = (overrides: Partial<MediaGrant> = {}): MediaGrant => ({
  matchId: 'match-1',
  mediaInstanceId: 'instance-1',
  receiverGeneration: 1,
  url: 'wss://media.example',
  token: 'grant-token',
  roomName: 'room-1',
  mediaIdentity: 'identity-p1-g1',
  expiresAt: NOW_SECONDS + 600,
  ...overrides,
});

function fakeRoom() {
  const listeners = new Map<string, (() => void)[]>();
  const room = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
  };
  return room;
}

function harness(options: { phase?: string } = {}) {
  const rooms: ReturnType<typeof fakeRoom>[] = [];
  const statuses: MediaStatus[] = [];
  let phase = options.phase ?? 'PLAYING';
  const deps: MediaSessionDeps = {
    createRoom: () => {
      const room = fakeRoom();
      rooms.push(room);
      return room as unknown as MediaRoomPort;
    },
    onStatus: (status) => statuses.push(status),
    epochNowSeconds: () => NOW_SECONDS,
    getPhase: () => phase,
  };
  return {
    session: createMediaSession(deps),
    rooms,
    statuses,
    setPhase: (next: string) => {
      phase = next;
    },
  };
}

describe('createMediaSession', () => {
  it('connects with autoSubscribe false using the approved url and token', async () => {
    const base = harness();

    await base.session.connect(grant());

    expect(base.rooms).toHaveLength(1);
    expect(base.rooms[0]!.connect).toHaveBeenCalledWith('wss://media.example', 'grant-token', {
      autoSubscribe: false,
    });
    expect(base.session.getScope()).toEqual({
      matchId: 'match-1',
      mediaInstanceId: 'instance-1',
      receiverGeneration: 1,
    });
  });

  it('creates one room and one connect for a duplicate grant', async () => {
    const base = harness();
    const value = grant();

    await Promise.all([base.session.connect(value), base.session.connect(value)]);
    await base.session.connect(value);

    expect(base.rooms).toHaveLength(1);
    expect(base.rooms[0]!.connect).toHaveBeenCalledTimes(1);
  });

  it('refuses to connect in the lobby or the device check', async () => {
    for (const phase of ['LOBBY', 'DEVICE_CHECK', 'RESULT']) {
      const base = harness({ phase });
      await expect(base.session.connect(grant())).rejects.toBeInstanceOf(MediaConnectionError);
      expect(base.rooms).toHaveLength(0);
      expect(base.session.getStatus().state).toBe('idle');
    }
  });

  it('refuses an expired or incomplete grant without calling connect', async () => {
    const expired = harness();
    await expect(expired.session.connect(grant({ expiresAt: NOW_SECONDS }))).rejects.toMatchObject({
      code: 'GRANT_EXPIRED',
    });
    expect(expired.rooms).toHaveLength(0);

    const incomplete = harness();
    await expect(incomplete.session.connect(grant({ token: '' }))).rejects.toMatchObject({
      code: 'GRANT_INCOMPLETE',
    });
    expect(incomplete.rooms).toHaveLength(0);
  });

  it('replaces the previous generation instead of keeping two live rooms', async () => {
    const base = harness();
    await base.session.connect(grant());

    await base.session.connect(grant({ receiverGeneration: 2 }));

    expect(base.rooms).toHaveLength(2);
    expect(base.rooms[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(base.rooms[0]!.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(base.session.getScope()!.receiverGeneration).toBe(2);
  });

  it('normalizes the room events into the media status of its own scope', async () => {
    const base = harness();
    await base.session.connect(grant());
    const room = base.rooms[0]!;

    room.emit(ROOM_EVENTS.connected);
    room.emit(ROOM_EVENTS.reconnecting);
    room.emit(ROOM_EVENTS.signalReconnecting);
    room.emit(ROOM_EVENTS.reconnected);
    room.emit(ROOM_EVENTS.disconnected);

    const states = base.statuses.map((status) => status.state);
    expect(states).toEqual([
      'connecting',
      'connected',
      'recovering',
      'recovering',
      'connected',
      'closed',
    ]);
    for (const status of base.statuses)
      expect(status).toMatchObject({
        matchId: 'match-1',
        mediaInstanceId: 'instance-1',
        receiverGeneration: 1,
      });
  });

  it('ignores the events of a retired generation', async () => {
    const base = harness();
    await base.session.connect(grant());
    const first = base.rooms[0]!;
    await base.session.connect(grant({ receiverGeneration: 2 }));
    const seen = base.statuses.length;

    first.emit(ROOM_EVENTS.connected);
    first.emit(ROOM_EVENTS.disconnected);

    expect(base.statuses).toHaveLength(seen);
  });

  it('disconnects a late success that arrived after the retire', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rooms: ReturnType<typeof fakeRoom>[] = [];
    const statuses: MediaStatus[] = [];
    const session = createMediaSession({
      createRoom: () => {
        const room = fakeRoom();
        room.connect = vi.fn(async () => gate);
        rooms.push(room);
        return room as unknown as MediaRoomPort;
      },
      onStatus: (status) => statuses.push(status),
      epochNowSeconds: () => NOW_SECONDS,
      getPhase: () => 'PLAYING',
    });

    const connecting = session.connect(grant());
    // 실제로 SDK connect가 시작된 뒤에 회수한다.
    await vi.waitFor(() => expect(rooms).toHaveLength(1));
    await session.retire();
    release();
    await connecting;

    expect(rooms[0]!.connect).toHaveBeenCalledTimes(1);
    expect(rooms[0]!.disconnect).toHaveBeenCalled();
    expect(session.getRoom()).toBeNull();
    expect(statuses.at(-1)!.state).toBe('closed');
    expect(statuses.some((status) => status.state === 'connected')).toBe(false);
  });

  it('never opens a room when the retire lands before the connect starts', async () => {
    const base = harness();

    const connecting = base.session.connect(grant());
    await base.session.retire();
    await connecting;

    expect(base.rooms).toHaveLength(0);
    expect(base.session.getRoom()).toBeNull();
  });

  it('reports a connect failure as a media failure', async () => {
    const rooms: ReturnType<typeof fakeRoom>[] = [];
    const statuses: MediaStatus[] = [];
    const session = createMediaSession({
      createRoom: () => {
        const room = fakeRoom();
        room.connect = vi.fn(async () => {
          throw new Error('signal failed');
        });
        rooms.push(room);
        return room as unknown as MediaRoomPort;
      },
      onStatus: (status) => statuses.push(status),
      epochNowSeconds: () => NOW_SECONDS,
      getPhase: () => 'PLAYING',
    });

    await expect(session.connect(grant())).rejects.toMatchObject({ code: 'CONNECT_FAILED' });

    expect(statuses.at(-1)).toMatchObject({ state: 'failed', code: 'CONNECT_FAILED' });
    expect(JSON.stringify(statuses)).not.toContain('signal failed');
    expect(session.getRoom()).toBeNull();
  });

  it('does not leak the grant token into the reported status', async () => {
    const base = harness();
    await base.session.connect(grant());

    expect(JSON.stringify(base.statuses)).not.toContain('grant-token');
  });

  it('keeps the media scope independent from any logical game revision', async () => {
    const base = harness();
    await base.session.connect(grant());

    const scope = base.session.getScope()!;
    expect(Object.keys(scope).sort()).toEqual(['matchId', 'mediaInstanceId', 'receiverGeneration']);
    expect(scope).not.toHaveProperty('gameInstanceId');
    expect(scope).not.toHaveProperty('revision');
  });

  it('closes the room and refuses new connects after dispose', async () => {
    const base = harness();
    await base.session.connect(grant());

    await base.session.dispose();
    await base.session.dispose();

    expect(base.rooms[0]!.disconnect).toHaveBeenCalledTimes(1);
    await expect(base.session.connect(grant())).rejects.toMatchObject({ code: 'DISPOSED' });
  });
});
