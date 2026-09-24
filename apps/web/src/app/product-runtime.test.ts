import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { clearConsentedDevice, useConsentedDevice } from '../features/room/consent-fixture';
import {
  createInteractionRuntime,
  type InteractionContext,
  type InteractionDeps,
  type InteractionRuntime,
} from '../features/input/InteractionRuntime';
import { bindProductRoom, type ProductRoomPort } from './product-runtime';
import { roundFixture, viewFixture } from '../features/room/product-fixture';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
import { DEFAULT_AUDIO_PREFERENCES } from '../features/media/audio-preferences';
import { MEDIA_ROUTES } from '@kkakkung/protocol/game-messages';
import { createRuntimeMetrics, type RuntimeMetrics } from './runtime-metrics';
import { INPUT_TUNING } from '../features/input/input-tuning';

// 장치를 켜는 시험들이다. 동의 없이는 다리가 장치에 닿지 않으므로(S15P21C204-292) 이미 동의한
// 기기에서 시작한다. 동의가 없을 때 닿지 않는다는 사실 자체는 consent-bypass 시험이 본다.
beforeAll(() => useConsentedDevice());
afterAll(() => clearConsentedDevice());

/** S15P21C204-265. 키보드는 모션과 같은 유지 시간을 채워야 하므로 시계와 타이머를 손으로 돈다. */
function manualVision() {
  const timers = new Map<number, () => void>();
  let clock = 0;
  let nextTimer = 0;
  return {
    vision: {
      now: () => clock,
      setTimer: (handler: () => void) => {
        const id = ++nextTimer;
        timers.set(id, handler);
        return id;
      },
      clearTimer: (id: number) => {
        timers.delete(id);
      },
      createWorker: () => {
        throw Error('No camera needed');
      },
      createFrameSource: () => {
        throw Error('No camera needed');
      },
    },
    /** 시계를 옮기고 그때까지 잡힌 타이머를 모두 깨운다. 이르게 깨어난 타이머는 스스로 다시 잔다. */
    elapse: (ms: number) => {
      clock += ms;
      for (const [id, handler] of [...timers.entries()]) {
        timers.delete(id);
        handler();
      }
    },
  };
}
function fixture(
  interactionFactory?: (deps: InteractionDeps) => InteractionRuntime,
  metrics?: RuntimeMetrics,
) {
  let now = 0;
  let sequence = 0;
  const messages = new Map<string, (value: unknown) => void>();
  let stateHandler!: (state: PublicMatchState) => void;
  let leaveHandler!: (code?: number) => void;
  const context = vi.fn<(context: InteractionContext) => void>();
  const end = vi.fn(async () => {});
  const dispose = vi.fn(async () => {});
  let callbacks!: InteractionDeps;
  const fake: InteractionRuntime = {
    setContext: context,
    endParticipation: end,
    dispose,
    startDevices: vi.fn(async () => INITIAL_DEVICES),
    setMicrophone: vi.fn(async () => INITIAL_DEVICES),
    calibrate: vi.fn(async () => INITIAL_DEVICES),
    connectMedia: vi.fn(async () => {}),
    applyAudioPolicy: vi.fn(),
    applyMediaBindings: vi.fn(),
    setQualityPreset: vi.fn(),
    retireMediaGeneration: vi.fn(async () => {}),
    beginMediaGeneration: vi.fn(),
    getGenerationState: () => 'live',
    publishMedia: vi.fn(async () => 'FACE_SELF'),
    getPublications: () => [],
    addRemoteTrack: vi.fn(),
    removeRemoteTrack: vi.fn(),
    setAudioOutputLock: vi.fn(),
    setAudioPreferences: vi.fn(),
    getLocalAudioStatus: () => ({
      preferences: DEFAULT_AUDIO_PREFERENCES,
      microphoneLevel: null,
      testTonePlaying: false,
    }),
    playTestTone: async () => 'unavailable',
    playCue: vi.fn(() => 'played' as const),
  };
  const send = vi.fn();
  const leave = vi.fn(async () => {});
  const room: ProductRoomPort = {
    state: roundFixture({ phase: 'DEVICE_CHECK' }) as unknown as PublicMatchState,
    send,
    leave,
    onMessage(type, handler) {
      messages.set(type, handler);
      return () => {
        messages.delete(type);
      };
    },
    onStateChange(handler) {
      stateHandler = handler;
      return vi.fn();
    },
    onLeave(handler) {
      leaveHandler = handler;
      return vi.fn();
    },
    onError: () => vi.fn(),
  };
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 }));
  const runtime = bindProductRoom(
    room,
    {
      sessionToken: 'private',
      playerId: 'self',
      roomCode: 'ABCDEF',
      expiresAt: 1900000000000,
      protocolVersion: '0.2.0',
    },
    {
      now: () => now,
      uuid: () => `10000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
      changed: vi.fn(),
      fetcher,
      interactionFactory: (deps) => {
        callbacks = deps;
        return interactionFactory?.(deps) ?? fake;
      },
      ...(metrics ? { metrics } : {}),
    },
  );
  return {
    runtime,
    messages,
    send,
    leave,
    end,
    dispose,
    context,
    fake,
    fetcher,
    get callbacks() {
      return callbacks;
    },
    state: (overrides: Parameters<typeof roundFixture>[0]) =>
      stateHandler(roundFixture(overrides) as unknown as PublicMatchState),
    close: (code?: number) => leaveHandler(code),
    time: (value: number) => {
      now = value;
      runtime.poll();
    },
  };
}

it('keeps the waiting lock across phase changes, clears it on rematch and rejects old access/rosters', async () => {
  const f = fixture();
  const roster = (matchId: string, hostId = 'self') => ({
    matchId,
    stateVersion: 10,
    phase: 'DEVICE_CHECK',
    hostId,
    players: ['self', 'friend'].map((playerId) => ({
      playerId,
      nickname: playerId,
      ready: false,
      connected: true,
    })),
  });
  f.messages.get('room-roster')!(roster('m'));
  f.runtime.send({ type: 'ROOM_LOCK', payload: { locked: true } });
  expect(f.send.mock.calls.filter((c) => c[0] === 'command')).toHaveLength(0);
  f.messages.get('room-access')!({ matchId: 'm', revision: 3, locked: true });
  f.messages.get('room-access')!({ matchId: 'm', revision: 2, locked: false });
  f.state({ phase: 'LOBBY', stateVersion: 11 });
  expect(f.runtime.getSnapshot().roomAccess?.locked).toBe(true);
  for (const targetPlayerId of ['self', 'foreign'])
    f.runtime.send({ type: 'ROOM_KICK', payload: { targetPlayerId } });
  expect(f.send.mock.calls.filter((c) => c[0] === 'command')).toHaveLength(0);
  f.runtime.send({ type: 'ROOM_LOCK', payload: { locked: false } });
  f.runtime.send({ type: 'ROOM_LOCK', payload: { locked: false } });
  expect(f.send.mock.calls.filter((c) => c[0] === 'command')).toHaveLength(1);
  f.state({ matchId: 'next', phase: 'LOBBY', stateVersion: 0 });
  expect(f.runtime.getSnapshot().roomAccess).toBeNull();
  expect(f.runtime.getSnapshot().roster).toBeNull();
  f.messages.get('room-roster')!(roster('next', 'friend'));
  f.messages.get('room-access')!({ matchId: 'next', revision: 3, locked: true });
  f.messages.get('room-roster')!(roster('m'));
  f.messages.get('room-access')!({ matchId: 'm', revision: 100, locked: false });
  f.runtime.send({ type: 'ROOM_LOCK', payload: { locked: false } });
  expect(f.runtime.getSnapshot().roomAccess).toEqual({
    matchId: 'next',
    revision: 3,
    locked: true,
  });
  expect(f.runtime.getSnapshot().roster?.hostId).toBe('friend');
  expect(f.send.mock.calls.filter((c) => c[0] === 'command')).toHaveLength(1);
  await f.runtime.leave();
});

it('reports host removal and disposes devices and the media bridge once', async () => {
  const f = fixture();
  f.close(4002);
  f.close(4002);
  expect(f.runtime.getSnapshot()).toMatchObject({
    lost: true,
    removedByHost: true,
    roomExpired: false,
  });
  await vi.waitFor(() => expect(f.end).toHaveBeenCalledOnce());
  f.runtime.send({ type: 'ROOM_LOCK', payload: { locked: false } });
  expect(f.send.mock.calls.filter((c) => c[0] === 'command')).toHaveLength(0);
  await f.runtime.leave();
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledOnce();
});
async function mediaFixture(options: { failInitial?: boolean; missingFace?: boolean } = {}) {
  const f = fixture();
  if (options.missingFace) vi.mocked(f.fake.publishMedia).mockResolvedValue(null);
  let next = 0;
  f.fetcher.mockImplementation(async (url) =>
    url === MEDIA_ROUTES.report
      ? new Response(null, { status: 204 })
      : new Response(
          JSON.stringify(
            url === MEDIA_ROUTES.grants
              ? {
                  matchId: 'm',
                  mediaInstanceId: options.failInitial ? 'media-1' : `media-${next + 1}`,
                  receiverGeneration: ++next,
                  url: 'wss://local.invalid',
                  token: 'fixture',
                  roomName: 'fixture',
                  mediaIdentity: `identity-${next}`,
                  expiresAt: 1900000000,
                }
              : { accepted: true },
          ),
          { status: 200 },
        ),
  );
  let failed = false;
  vi.mocked(f.fake.connectMedia).mockImplementation(async (grant) => {
    if (options.failInitial && !failed) {
      failed = true;
      f.callbacks.onMediaStatus({ ...grant, state: 'failed', code: 'CONNECT_FAILED' });
      throw new Error('CONNECT_FAILED');
    }
    f.callbacks.onMediaStatus({
      matchId: grant.matchId,
      mediaInstanceId: grant.mediaInstanceId,
      receiverGeneration: grant.receiverGeneration,
      state: 'connected',
      code: null,
    });
  });
  f.state({ phase: 'TEAM_PRACTICE' });
  f.messages.get('private-view')!(
    viewFixture({ gameScope: { kind: 'practice', revision: 1, gameInstanceId: 'practice' } }),
  );
  await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledOnce());
  const requests = () =>
    f.fetcher.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) }));
  return { ...f, requests };
}

async function recoveryFixture(phase: 'TEAM_PRACTICE' | 'GAME_LOADING' | 'COUNTDOWN' | 'PLAYING') {
  const f = await mediaFixture();
  if (phase !== 'TEAM_PRACTICE') {
    f.state({ phase: 'GAME_LOADING', stateVersion: 11 });
    f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
    await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledTimes(2));
    if (phase !== 'GAME_LOADING') {
      f.state({ phase, stateVersion: 12 });
      f.messages.get('private-view')!(viewFixture({ stateVersion: 12 }));
    }
  }
  const media = f.runtime.getSnapshot().media!;
  const scope = {
    matchId: media.matchId!,
    mediaInstanceId: media.mediaInstanceId!,
    receiverGeneration: media.receiverGeneration!,
  };
  const grant = {
    ...scope,
    receiverGeneration: scope.receiverGeneration + 1,
    url: 'wss://local.invalid',
    token: 'fixture',
    roomName: 'fixture',
    mediaIdentity: 'replacement-identity',
    expiresAt: 1900000000,
  };
  f.fetcher.mockImplementation(async (url) =>
    url === MEDIA_ROUTES.report
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(grant), { status: 200 }),
  );
  const before = f.requests().length;
  const disconnect = () =>
    f.callbacks.onMediaStatus({ ...scope, state: 'closed', code: 'DISCONNECTED' });
  return { ...f, scope, grant, disconnect, sinceFailure: () => f.requests().slice(before) };
}

it.each(['TEAM_PRACTICE', 'GAME_LOADING', 'COUNTDOWN', 'PLAYING'] as const)(
  'replaces one terminal SDK generation during %s without replacing logical game knowledge',
  async (phase) => {
    const f = await recoveryFixture(phase);
    const view = f.runtime.getSnapshot().view;
    const published = vi.mocked(f.fake.publishMedia).mock.calls.length;
    let finish!: () => void;
    vi.mocked(f.fake.retireMediaGeneration).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          // An intentional local closed callback must not enqueue another recovery.
          f.callbacks.onMediaStatus({ ...f.scope, state: 'closed', code: 'RETIRED' });
          finish = resolve;
        }),
    );
    f.disconnect();
    f.disconnect();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(f.sinceFailure().filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(0);
    expect(f.sinceFailure().filter((r) => r.body.status === 'closed')).toHaveLength(0);
    expect(f.fake.retireMediaGeneration).toHaveBeenLastCalledWith('reconnect');
    finish();
    await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledTimes(published + 1));
    const requests = f.sinceFailure();
    const closed = requests.findIndex((r) => r.body.status === 'closed');
    expect(requests[closed]?.body).toEqual({ ...f.scope, status: 'closed' });
    expect(requests[closed + 1]).toMatchObject({
      url: MEDIA_ROUTES.grants,
      body: { matchId: 'm', previousReceiverGeneration: f.scope.receiverGeneration },
    });
    expect(requests.filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(1);
    expect(f.runtime.getSnapshot().media).toMatchObject({
      ...f.scope,
      receiverGeneration: f.scope.receiverGeneration + 1,
      state: 'connected',
    });
    expect(f.runtime.getSnapshot().view).toBe(view);
    expect(f.runtime.getSnapshot().lost).toBe(false);
    expect(f.runtime.getSnapshot().error).toBeNull();
    f.disconnect(); // old generation event after the replacement is ignored.
    expect(f.sinceFailure().filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(1);
    await f.runtime.leave();
  },
);

it('keeps a short SDK reconnect in the current generation and reports recovery immediately', async () => {
  const f = await recoveryFixture('PLAYING');
  f.callbacks.onMediaStatus({ ...f.scope, state: 'recovering', code: 'RECONNECTING' });
  f.callbacks.onMediaStatus({ ...f.scope, state: 'connected', code: null });
  await Promise.resolve();
  expect(f.sinceFailure()).toEqual([
    { url: MEDIA_ROUTES.report, body: { ...f.scope, status: 'recovering' } },
  ]);
  await f.runtime.leave();
});

it('recovers an initial SDK connect failure once without recursively requesting more grants', async () => {
  const f = await mediaFixture({ failInitial: true });
  expect(f.fake.connectMedia).toHaveBeenCalledTimes(2);
  expect(f.requests().filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(2);
  expect(f.runtime.getSnapshot().error).toBeNull();
  await f.runtime.leave();
});

it.each(['report', 'cleanup', 'grant', 'connect'] as const)(
  'does not retry full replacement after %s failure',
  async (failure) => {
    const f = await recoveryFixture('PLAYING');
    const requests = vi.mocked(f.fetcher).getMockImplementation()!;
    if (failure === 'cleanup')
      vi.mocked(f.fake.retireMediaGeneration).mockRejectedValueOnce(new Error('cleanup failure'));
    if (failure === 'report' || failure === 'grant')
      f.fetcher.mockImplementation(async (url, init) =>
        url === (failure === 'report' ? MEDIA_ROUTES.report : MEDIA_ROUTES.grants)
          ? new Response('{}', { status: 409 })
          : requests(url, init),
      );
    if (failure === 'connect')
      vi.mocked(f.fake.connectMedia).mockImplementationOnce(async (grant) => {
        f.callbacks.onMediaStatus({ ...grant, state: 'failed', code: 'CONNECT_FAILED' });
        throw new Error('CONNECT_FAILED');
      });
    f.disconnect();
    await vi.waitFor(() => expect(f.runtime.getSnapshot().error).not.toBeNull());
    const count = f.sinceFailure().filter((r) => r.url === MEDIA_ROUTES.grants).length;
    f.disconnect();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.sinceFailure().filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(count);
    expect(count).toBe(failure === 'report' || failure === 'cleanup' ? 0 : 1);
    await f.runtime.leave().catch(() => {});
  },
);

it('does not connect or publish a late recovery grant after the round ends', async () => {
  const f = await recoveryFixture('PLAYING');
  const published = vi.mocked(f.fake.publishMedia).mock.calls.length;
  let deliver!: (response: Response) => void;
  const requests = vi.mocked(f.fetcher).getMockImplementation()!;
  f.fetcher.mockImplementation((url, init) =>
    url === MEDIA_ROUTES.grants
      ? new Promise((resolve) => {
          deliver = resolve;
        })
      : requests(url, init),
  );
  f.disconnect();
  await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
  f.state({ phase: 'ABORTED', stateVersion: 13 });
  deliver(new Response(JSON.stringify(f.grant), { status: 200 }));
  await vi.waitFor(() =>
    expect(f.sinceFailure().filter((r) => r.body.status === 'closed')).toHaveLength(2),
  );
  expect(f.fake.publishMedia).toHaveBeenCalledTimes(published);
  expect(f.runtime.getSnapshot().round?.phase).toBe('ABORTED');
  await f.runtime.leave();
});

it.each(['match', 'instance', 'generation'] as const)(
  'rejects a replacement grant with an unexpected %s before SDK connection',
  async (mismatch) => {
    const f = await recoveryFixture('PLAYING');
    const connected = vi.mocked(f.fake.connectMedia).mock.calls.length;
    const grant = { ...f.grant };
    if (mismatch === 'match') grant.matchId = 'old-match';
    if (mismatch === 'instance') grant.mediaInstanceId = 'another-instance';
    if (mismatch === 'generation') grant.receiverGeneration = f.scope.receiverGeneration;
    f.fetcher.mockImplementation(async (url) =>
      url === MEDIA_ROUTES.report
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(grant), { status: 200 }),
    );
    f.disconnect();
    await vi.waitFor(() => expect(f.runtime.getSnapshot().error).not.toBeNull());
    expect(f.fake.connectMedia).toHaveBeenCalledTimes(connected);
    await f.runtime.leave();
  },
);

it.each(['rejected', 'late-ready'] as const)(
  'preserves the issued predecessor when a %s practice recovery overlaps entry into game loading',
  async (result) => {
    const f = await recoveryFixture('TEAM_PRACTICE');
    let complete!: (response: Response) => void;
    let requested = 0;
    const nextGeneration = result === 'late-ready' ? 3 : 2;
    f.fetcher.mockImplementation(async (url) => {
      if (url === MEDIA_ROUTES.report) return new Response(null, { status: 204 });
      requested++;
      if (requested === 1)
        return new Promise((resolve) => {
          complete = resolve;
        });
      return new Response(
        JSON.stringify({
          ...f.grant,
          mediaInstanceId: 'game-media',
          receiverGeneration: nextGeneration,
        }),
        { status: 200 },
      );
    });
    f.disconnect();
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    f.state({ phase: 'MAP_FINALIZING', stateVersion: 11 });
    f.state({ phase: 'GAME_LOADING', stateVersion: 12 });
    f.messages.get('private-view')!(viewFixture({ stateVersion: 12 }));
    complete(
      result === 'late-ready'
        ? new Response(JSON.stringify(f.grant), { status: 200 })
        : new Response('{}', { status: 409 }),
    );
    await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledTimes(2));
    const grants = f.sinceFailure().filter((r) => r.url === MEDIA_ROUTES.grants);
    expect(grants).toHaveLength(2);
    expect(grants[1]?.body).toEqual({
      matchId: 'm',
      purpose: 'game',
      previousReceiverGeneration: nextGeneration - 1,
    });
    expect(
      vi.mocked(f.fake.connectMedia).mock.calls.map(([grant]) => grant.receiverGeneration),
    ).toEqual([1, nextGeneration]);
    expect(f.runtime.getSnapshot().error).toBeNull();
    await f.runtime.leave();
  },
);

it.each(['before-disconnect', 'awaiting-grant'] as const)(
  'keeps same-game recovery through a public-phase/private-view gap %s',
  async (timing) => {
    const f = await recoveryFixture('COUNTDOWN');
    const published = vi.mocked(f.fake.publishMedia).mock.calls.length;
    let complete!: (response: Response) => void;
    const requests = vi.mocked(f.fetcher).getMockImplementation()!;
    f.fetcher.mockImplementation((url, init) =>
      url === MEDIA_ROUTES.grants
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : requests(url, init),
    );
    if (timing === 'before-disconnect') f.state({ phase: 'PLAYING', stateVersion: 13 });
    f.disconnect();
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    if (timing === 'awaiting-grant') f.state({ phase: 'PLAYING', stateVersion: 13 });
    expect(f.runtime.getSnapshot().view).toBeNull();
    complete(new Response(JSON.stringify(f.grant), { status: 200 }));
    await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledTimes(published + 1));
    f.messages.get('private-view')!(viewFixture({ stateVersion: 13 }));
    expect(f.runtime.getSnapshot().media).toMatchObject({
      mediaInstanceId: f.scope.mediaInstanceId,
      receiverGeneration: f.scope.receiverGeneration + 1,
      state: 'connected',
    });
    expect(f.runtime.getSnapshot().view?.gameScope).toEqual(viewFixture().gameScope);
    expect(f.runtime.getSnapshot().error).toBeNull();
    await f.runtime.leave();
  },
);

it('reports SDK recovery immediately but closed only after old local cleanup before the next grant', async () => {
  const f = await mediaFixture();
  const old = { matchId: 'm', mediaInstanceId: 'media-1', receiverGeneration: 1 };
  f.callbacks.onMediaStatus({ ...old, state: 'recovering', code: 'RECONNECTING' });
  await vi.waitFor(() =>
    expect(f.requests().some((r) => r.body.status === 'recovering')).toBe(true),
  );
  let finish!: () => void;
  vi.mocked(f.fake.retireMediaGeneration).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.state({ phase: 'GAME_LOADING', stateVersion: 11 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(f.requests().filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(1);
  expect(f.requests().filter((r) => r.body.status === 'closed')).toHaveLength(0);
  finish();
  await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledTimes(2));
  const requests = f.requests();
  const closedIndex = requests.findIndex((r) => r.body.status === 'closed');
  expect(requests[closedIndex]?.body).toEqual({ ...old, status: 'closed' });
  expect(requests[closedIndex + 1]).toMatchObject({
    url: MEDIA_ROUTES.grants,
    body: { previousReceiverGeneration: 1 },
  });
  await f.runtime.leave();
});

it('cleans up a lost game connection without reporting from an invalidated participant', async () => {
  const f = await mediaFixture();
  f.close();
  await expect(f.runtime.leave()).resolves.toBeUndefined();
  expect(f.runtime.getSnapshot().lost).toBe(true);
  expect(f.runtime.getSnapshot().error).toBeNull();
  expect(f.fake.retireMediaGeneration).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledOnce();
  expect(f.requests().filter((r) => r.body.status === 'closed')).toHaveLength(0);
  expect(f.requests().filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(1);
});

it('preserves room expiry as the leave reason while cleaning local resources', async () => {
  const f = fixture();
  f.close(4001);
  await f.runtime.leave();
  expect(f.runtime.getSnapshot()).toMatchObject({ lost: true, roomExpired: true });
  expect(f.dispose).toHaveBeenCalledOnce();
});

it('finishes local exit if the game connection closes while its report is in flight', async () => {
  const f = await mediaFixture();
  let finishReport!: (response: Response) => void;
  f.fetcher.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishReport = resolve;
      }),
  );
  const leaving = f.runtime.leave();
  await vi.waitFor(() => expect(finishReport).toBeTypeOf('function'));
  f.close();
  finishReport(new Response('{}', { status: 409 }));
  await expect(leaving).resolves.toBeUndefined();
  expect(f.end).toHaveBeenCalledOnce();
  expect(f.runtime.getSnapshot().error).toBeNull();
});

it('does not acknowledge closed or request a replacement after local cleanup fails', async () => {
  const f = await mediaFixture();
  vi.mocked(f.fake.retireMediaGeneration).mockRejectedValueOnce(new Error('local failure'));
  f.state({ phase: 'GAME_LOADING', stateVersion: 11 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
  await vi.waitFor(() => expect(f.runtime.getSnapshot().error).not.toBeNull());
  expect(f.requests().filter((r) => r.body.status === 'closed')).toHaveLength(0);
  expect(f.requests().filter((r) => r.url === MEDIA_ROUTES.grants)).toHaveLength(1);
  await expect(f.runtime.leave()).rejects.toThrow('local failure');
});

it('ignores late binding and SDK status from an old generation after replacement', async () => {
  const f = await mediaFixture();
  f.state({ phase: 'GAME_LOADING', stateVersion: 11 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
  await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledTimes(2));
  const binding = {
    matchId: 'm',
    mediaInstanceId: 'media-2',
    receiverGeneration: 2,
    bindingRevision: 5,
    participants: [],
  };
  f.messages.get('media-bindings')!(binding);
  f.messages.get('media-bindings')!({
    ...binding,
    mediaInstanceId: 'media-1',
    receiverGeneration: 1,
  });
  f.callbacks.onMediaStatus({
    matchId: 'm',
    mediaInstanceId: 'media-1',
    receiverGeneration: 1,
    state: 'closed',
    code: 'DISCONNECTED',
  });
  expect(f.fake.applyMediaBindings).toHaveBeenCalledExactlyOnceWith(binding);
  expect(f.runtime.getSnapshot().media).toMatchObject({
    mediaInstanceId: 'media-2',
    receiverGeneration: 2,
    state: 'connected',
  });
  await f.runtime.leave();
});
it('shares installation pending across D and buttons without optimistic inventory or stale cancel', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  const v = viewFixture();
  if (v.self?.status !== 'ACTIVE') throw Error();
  f.messages.get('private-view')!({
    ...v,
    self: { ...v.self, role: 'tagger', equipment: { sensor: 2, trap: 1 } },
  });
  f.runtime.selectEquipment('trap');
  expect(f.context.mock.lastCall?.[0].selectedEquipment).toBe('trap');
  const first = f.runtime.send({ type: 'INSTALL', payload: { kind: 'trap' } });
  expect(f.callbacks.sendCommand({ type: 'INSTALL', payload: { kind: 'trap' } })).toBe(first);
  expect(f.send.mock.calls.filter(([channel]) => channel === 'command')).toHaveLength(1);
  expect(f.runtime.send({ type: 'INSTALL_CANCEL', payload: { installationId: 'stale' } })).toBe('');
  expect(f.runtime.getSnapshot().view?.self).toMatchObject({ equipment: { sensor: 2, trap: 1 } });
  await f.runtime.leave();
});
it.each(['move', 'turn'] as const)(
  'blocks both installation senders during %s without spending inventory',
  async (kind) => {
    const f = fixture();
    f.state({ phase: 'PLAYING' });
    const v = viewFixture();
    if (v.self?.status !== 'ACTIVE') throw Error();
    const self = {
      ...v.self,
      role: 'tagger' as const,
      equipment: { sensor: 2, trap: 1 },
      action: {
        kind,
        from: { x: 1, y: 1, dir: 0 as const },
        to: { x: 2, y: 1, dir: 1 as const },
        startTick: 100,
        endTick: 120,
      },
    };
    f.messages.get('private-view')!({ ...v, self });
    expect(f.runtime.send({ type: 'INSTALL', payload: { kind: 'trap' } })).toBe('');
    expect(f.callbacks.sendCommand({ type: 'INSTALL', payload: { kind: 'sensor' } })).toBe('');
    expect(f.send.mock.calls.filter(([channel]) => channel === 'command')).toHaveLength(0);
    f.messages.get('private-view')!({ ...v, stateVersion: 11, self: { ...self, action: null } });
    // A future private view remains buffered until its public state version arrives.
    expect(f.callbacks.sendCommand({ type: 'INSTALL', payload: { kind: 'trap' } })).toBe('');
    f.state({ phase: 'PLAYING', stateVersion: 11, serverTick: 120 });
    expect(f.callbacks.sendCommand({ type: 'INSTALL', payload: { kind: 'trap' } })).not.toBe('');
    expect(f.runtime.getSnapshot().view?.self).toMatchObject({ equipment: { sensor: 2, trap: 1 } });
    await f.runtime.leave();
  },
);
it('does not send an expired incoming exchange even when its view has not cleared', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING', serverTick: 100 });
  const v = viewFixture();
  if (v.self?.status !== 'ACTIVE') throw Error();
  f.messages.get('private-view')!({
    ...v,
    self: {
      ...v.self,
      exchange: {
        exchangeId: 'expired',
        fromPlayerId: 'ally',
        toPlayerId: 'self',
        direction: 'incoming',
        expiresAtTick: 100,
      },
    },
  });
  expect(
    f.callbacks.sendCommand({ type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'expired' } }),
  ).toBe('');
  expect(f.send.mock.calls.filter(([channel]) => channel === 'command')).toHaveLength(0);
  await f.runtime.leave();
});
it('connects heartbeat ACK on the actual product channel with no media calls in lobby/device check', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) {
    f.time(i * 2000);
    f.messages.get('game-heartbeat')!({
      matchId: 'm',
      serverEpoch: 'e',
      heartbeatSeq: i,
      serverTick: i * 40,
      serverTimeMs: i * 2000,
    });
  }
  expect(f.send.mock.calls.filter((c) => c[0] === 'game-heartbeat-ack')).toHaveLength(5);
  expect(f.runtime.getSnapshot().lost).toBe(false);
  expect(f.fetcher).not.toHaveBeenCalled();
  await f.runtime.leave();
  expect(f.dispose).toHaveBeenCalledOnce();
});
it('shares EXIT_START with D and waits for challenge projection after an applied outcome', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  expect(f.context.mock.lastCall?.[0].exitId).toBe('exit');
  const id = f.runtime.send({ type: 'EXIT_START', payload: { exitId: 'exit' } });
  expect(f.callbacks.sendCommand({ type: 'EXIT_START', payload: { exitId: 'exit' } })).toBe(id);
  f.messages.get('command-outcome')!({
    matchId: 'm',
    requestId: id,
    sequence: 0,
    tick: 100,
    stateVersion: 10,
    result: 'applied',
    code: null,
  });
  expect(f.runtime.getSnapshot().exitStarting).toBe(true);
  expect(f.runtime.send({ type: 'EXIT_START', payload: { exitId: 'exit' } })).toBe(id);
  f.time(2001);
  expect(f.runtime.getSnapshot().exitStarting).toBe(false);
  expect(f.runtime.getSnapshot().requests.EXIT_START?.status).toBe('unconfirmed');
  expect(f.send.mock.calls.filter(([channel]) => channel === 'command')).toHaveLength(1);
  await f.runtime.leave();
});
it.each([0, 1, 2, 3] as const)(
  'only starts an exit when facing wall side %i from its approach',
  async (side) => {
    const f = fixture();
    try {
      f.state({ phase: 'PLAYING' });
      const view = viewFixture();
      if (view.self?.status !== 'ACTIVE') throw Error();
      const vectors = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ];
      const vector = vectors[side]!;
      const wall = { x: 1 - vector.x, y: 1 - vector.y, side };
      for (const dir of [side, (side + 1) % 4, (side + 3) % 4, (side + 2) % 4] as const) {
        const stateVersion = ++view.stateVersion;
        f.state({ phase: 'PLAYING', stateVersion });
        f.messages.get('private-view')!({
          ...view,
          stateVersion,
          self: { ...view.self, dir },
          knownActiveExits: [{ ...view.knownActiveExits[0]!, wall }],
          visibleWallFaces: [wall],
        });
        const facing = dir === (side + 2) % 4;
        expect(f.context.mock.lastCall?.[0].exitId).toBe(facing ? 'exit' : undefined);
        expect(!!f.runtime.send({ type: 'EXIT_START', payload: { exitId: 'exit' } })).toBe(facing);
      }
      expect(f.send.mock.calls.filter(([channel]) => channel === 'command')).toHaveLength(1);
    } finally {
      await f.runtime.leave();
    }
  },
);

it('sends a final movement stop on blur through the real keyboard input runtime', async () => {
  const keys = new Map<string, (event: KeyboardEvent) => void>();
  const manual = manualVision();
  const f = fixture((deps) =>
    createInteractionRuntime(deps, {
      keyboardTarget: {
        addEventListener: (type, listener) => {
          keys.set(type, listener);
        },
        removeEventListener: (type) => {
          keys.delete(type);
        },
      },
      vision: manual.vision,
    }),
  );
  try {
    f.state({ phase: 'PLAYING' });
    f.messages.get('private-view')!(viewFixture());
    // 이동 키는 키보드 모드에서만, 모션과 같은 유지 시간을 채운 뒤에 움직인다(265).
    f.runtime.selectInputMode('keyboard');
    const event = {
      code: 'KeyW',
      repeat: false,
      isComposing: false,
      target: null,
      preventDefault() {},
    } as KeyboardEvent;
    keys.get('keydown')!(event);
    expect(f.send.mock.calls.filter(([channel]) => channel === 'command')).toEqual([]);
    manual.elapse(INPUT_TUNING.forwardHoldMs);
    f.runtime.setPageActive(false);
    keys.get('keydown')!(event);
    expect(f.runtime.send({ type: 'MOVE_INTENT', payload: { direction: 'forward' } })).toBe('');
    expect(f.runtime.send({ type: 'TURN', payload: { direction: 'left' } })).toBe('');
    expect(
      f.send.mock.calls.filter(([channel]) => channel === 'command').map(([, message]) => message),
    ).toMatchObject([
      { type: 'MOVE_INTENT', payload: { direction: 'forward' } },
      { type: 'MOVE_INTENT', payload: { direction: null } },
    ]);
    f.state({ phase: 'RESULT', stateVersion: 11 });
    expect(f.runtime.send({ type: 'MOVE_INTENT', payload: { direction: null } })).toBe('');
  } finally {
    await f.runtime.leave();
  }
});

it('routes explicit keyboard mode to real left and right turn handlers', async () => {
  const keys = new Map<string, (event: KeyboardEvent) => void>();
  const manual = manualVision();
  const f = fixture((deps) =>
    createInteractionRuntime(deps, {
      keyboardTarget: {
        addEventListener: (type, listener) => {
          keys.set(type, listener);
        },
        removeEventListener: (type) => {
          keys.delete(type);
        },
      },
      vision: manual.vision,
    }),
  );
  const key = (type: string, code: string, repeat = false) =>
    keys.get(type)!({
      code,
      repeat,
      isComposing: false,
      target: null,
      preventDefault() {},
    } as KeyboardEvent);
  const commands = () =>
    f.send.mock.calls.filter(([channel]) => channel === 'command').map(([, value]) => value);
  try {
    f.state({ phase: 'PLAYING' });
    f.messages.get('private-view')!(viewFixture());
    key('keydown', 'KeyA');
    manual.elapse(INPUT_TUNING.turnHoldMs);
    key('keyup', 'KeyA');
    expect(commands()).toEqual([]);
    f.runtime.selectInputMode('keyboard');
    expect(f.runtime.getSnapshot().interaction.mode).toBe('keyboard');
    // 회전 키도 모션처럼 유지 시간을 채워야 한 번 발동하고, 자동 반복은 무시한다(265).
    key('keydown', 'KeyA');
    key('keydown', 'KeyA', true);
    expect(commands()).toEqual([]);
    manual.elapse(INPUT_TUNING.turnHoldMs);
    key('keyup', 'KeyA');
    // 놓은 직후의 다음 키는 중립 대기가 끝나기 전이라 받지 않는다.
    key('keydown', 'ArrowRight');
    manual.elapse(INPUT_TUNING.turnHoldMs);
    key('keyup', 'ArrowRight');
    expect(commands()).toMatchObject([{ type: 'TURN', payload: { direction: 'left' } }]);
    manual.elapse(INPUT_TUNING.neutralHoldMs);
    key('keydown', 'ArrowRight');
    manual.elapse(INPUT_TUNING.turnHoldMs);
    key('keyup', 'ArrowRight');
    expect(commands()).toMatchObject([
      { type: 'TURN', payload: { direction: 'left' } },
      { type: 'TURN', payload: { direction: 'right' } },
    ]);
  } finally {
    await f.runtime.leave();
  }
});

it('locks movement while recalibrating and resumes motion after fresh calibration', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  const ready = {
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
  } as const;
  f.callbacks.onDeviceStatus(ready);
  f.runtime.selectInputMode('motion');
  let finish!: () => void;
  vi.mocked(f.fake.calibrate).mockImplementation(async () => {
    f.callbacks.onDeviceStatus({ ...ready, calibration: 'running' });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.callbacks.onDeviceStatus(ready);
    return ready;
  });
  try {
    const calibration = f.runtime.calibrateMotion();
    expect(f.runtime.getSnapshot().interaction.mode).toBe('motion');
    expect(f.context.mock.lastCall?.[0].pageActive).toBe(false);
    expect(f.runtime.send({ type: 'MOVE_INTENT', payload: { direction: 'forward' } })).toBe('');
    expect(f.runtime.send({ type: 'TURN', payload: { direction: 'right' } })).toBe('');
    await f.runtime.calibrateMotion();
    expect(f.fake.calibrate).toHaveBeenCalledOnce();
    finish();
    await calibration;
    expect(f.context.mock.lastCall?.[0]).toMatchObject({ pageActive: true, mode: 'motion' });
    expect(f.runtime.send({ type: 'TURN', payload: { direction: 'right' } })).not.toBe('');
  } finally {
    await f.runtime.leave();
  }
});

it('keeps keyboard input usable during device recovery and requires explicit motion selection', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  f.runtime.selectInputMode('keyboard');
  let finish!: () => void;
  vi.mocked(f.fake.calibrate).mockImplementation(async () => {
    f.callbacks.onDeviceStatus({ ...INITIAL_DEVICES, camera: 'ready', calibration: 'running' });
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    const ready = {
      ...INITIAL_DEVICES,
      camera: 'ready',
      vision: 'ready',
      calibration: 'ready',
    } as const;
    f.callbacks.onDeviceStatus(ready);
    return ready;
  });
  try {
    const recovering = f.runtime.recoverDevices();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(f.context.mock.lastCall?.[0]).toMatchObject({ pageActive: true, mode: 'keyboard' });
    expect(f.runtime.send({ type: 'TURN', payload: { direction: 'right' } })).not.toBe('');
    finish();
    await recovering;
    expect(f.runtime.getSnapshot().interaction.mode).toBe('keyboard');
    expect(f.leave).not.toHaveBeenCalled();
    expect(f.fake.retireMediaGeneration).not.toHaveBeenCalled();
  } finally {
    await f.runtime.leave();
  }
});

// S15P21C204-384. 카메라 없이 키보드로 하던 사람이 모션을 고르면 카메라부터 켜고 보정한다.
it('starts the camera before calibrating when motion is chosen with the camera off', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  f.runtime.selectInputMode('keyboard');
  const ready = {
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
  } as const;
  vi.mocked(f.fake.startDevices).mockImplementation(async () => {
    f.callbacks.onDeviceStatus({ ...INITIAL_DEVICES, camera: 'ready', vision: 'ready' });
    return { ...INITIAL_DEVICES, camera: 'ready', vision: 'ready' };
  });
  vi.mocked(f.fake.calibrate).mockImplementation(async () => {
    f.callbacks.onDeviceStatus(ready);
    return ready;
  });
  try {
    await f.runtime.calibrateMotion();
    expect(f.fake.startDevices).toHaveBeenCalledOnce();
    expect(f.fake.calibrate).toHaveBeenCalledOnce();
    expect(f.runtime.getSnapshot().interaction.mode).toBe('motion');
  } finally {
    await f.runtime.leave();
  }
});

it('stays on keyboard when the camera still cannot start', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  f.runtime.selectInputMode('keyboard');
  try {
    await f.runtime.calibrateMotion();
    expect(f.fake.startDevices).toHaveBeenCalledOnce();
    expect(f.runtime.getSnapshot().interaction.mode).toBe('keyboard');
  } finally {
    await f.runtime.leave();
  }
});

it('does not overwrite a newer keyboard choice when calibration completes', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  f.callbacks.onDeviceStatus({ ...INITIAL_DEVICES, camera: 'ready' });
  let finish!: () => void;
  vi.mocked(f.fake.calibrate).mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { ...INITIAL_DEVICES, camera: 'ready', calibration: 'ready' };
  });
  try {
    const calibration = f.runtime.calibrateMotion();
    f.runtime.selectInputMode('keyboard');
    finish();
    await calibration;
    expect(f.runtime.getSnapshot().interaction.mode).toBe('keyboard');
  } finally {
    await f.runtime.leave();
  }
});

it('keeps keyboard available if motion recalibration fails', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  f.callbacks.onDeviceStatus({ ...INITIAL_DEVICES, camera: 'ready' });
  f.runtime.selectInputMode('keyboard');
  vi.mocked(f.fake.calibrate).mockResolvedValue({
    ...INITIAL_DEVICES,
    camera: 'ready',
    calibration: 'failed',
    errorCode: 'CALIBRATION_NO_POSE',
  });
  try {
    await f.runtime.calibrateMotion();
    expect(f.runtime.getSnapshot().interaction.mode).toBe('keyboard');
    expect(f.context.mock.lastCall?.[0]).toMatchObject({ pageActive: true, mode: 'keyboard' });
  } finally {
    await f.runtime.leave();
  }
});

it('advances the local grab animation only for each outgoing grab attempt', () => {
  const f = fixture();
  f.state({ phase: 'PLAYING', stateVersion: 10 });
  const view = viewFixture({ stateVersion: 10 });
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  f.messages.get('private-view')!({
    ...view,
    self: { ...view.self, role: 'tagger' },
  });

  const first = f.runtime.send({ type: 'GRAB_INTENT', payload: {} });
  expect(f.runtime.getSnapshot().grabAnimationId).toBe(1);
  f.runtime.send({ type: 'GRAB_INTENT', payload: {} });
  expect(f.runtime.getSnapshot().grabAnimationId).toBe(2);

  f.messages.get('command-outcome')!({
    matchId: 'm',
    requestId: first,
    sequence: 0,
    tick: 100,
    stateVersion: 10,
    result: 'applied',
    code: null,
  });
  expect(f.runtime.getSnapshot().grabAnimationId).toBe(2);
});

it('releases rejected exit start immediately without creating a challenge', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(viewFixture());
  const id = f.runtime.send({ type: 'EXIT_START', payload: { exitId: 'exit' } });
  f.messages.get('command-result')!({
    matchId: 'm',
    requestId: id,
    sequence: 0,
    stateVersion: 10,
    status: 'rejected',
    code: 'NOT_ALLOWED',
  });
  expect(f.runtime.getSnapshot().exitStarting).toBe(false);
  expect(f.runtime.getSnapshot().view?.self).toMatchObject({ challenge: null });
  expect(f.runtime.send({ type: 'EXIT_START', payload: { exitId: 'exit' } })).not.toBe(id);
  await f.runtime.leave();
});
it('gates practice readiness on actual devices, withdraws on failure and clears practice knowledge', async () => {
  const f = fixture();
  f.state({ phase: 'TEAM_PRACTICE' });
  const view = viewFixture({
    gameScope: { kind: 'practice', revision: 1, gameInstanceId: 'practice' },
  });
  f.messages.get('private-view')!(view);
  expect(f.runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } })).toBe('');
  f.callbacks.onDeviceStatus({
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
    audioPlayback: 'ready',
  });
  expect(f.runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } })).not.toBe('');
  f.callbacks.onDeviceStatus(INITIAL_DEVICES);
  expect(f.send.mock.calls.filter(([type]) => type === 'command').at(-1)?.[1]).toMatchObject({
    type: 'PRACTICE_READY',
    payload: { ready: false },
  });
  expect(f.runtime.getSnapshot().practiceReady).toBe(false);
  f.state({ phase: 'MAP_FINALIZING', stateVersion: 11 });
  expect(f.runtime.getSnapshot().view).toBeNull();
  expect(f.runtime.getSnapshot().markers).toEqual([]);
  expect(f.context.mock.lastCall?.[0].pageActive).toBe(false);
  f.messages.get('private-view')!(view);
  expect(f.runtime.getSnapshot().view).toBeNull();
  await f.runtime.leave();
});
it('locks COUNTDOWN, tab hide and socket close synchronously and cleans up once', async () => {
  const f = fixture();
  f.state({ phase: 'COUNTDOWN', stateVersion: 11 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
  expect(f.context.mock.lastCall?.[0].pageActive).toBe(false);
  expect(f.runtime.send({ type: 'TURN', payload: { direction: 'left' } })).toBe('');
  f.state({ stateVersion: 12 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 12 }));
  f.runtime.setPageActive(false);
  expect(f.context.mock.lastCall?.[0].pageActive).toBe(false);
  f.close();
  f.time(6000);
  await f.runtime.leave();
  expect(f.runtime.getSnapshot().lost).toBe(true);
  expect(f.end).toHaveBeenCalledOnce();
  expect(f.leave).toHaveBeenCalledOnce();
  expect(f.messages.size).toBe(0);
});
it('keeps Room and media until the round result, then removes the scene and leaves independently', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(
    viewFixture({ self: { playerId: 'self', role: 'runner', status: 'ESCAPED' } }),
  );
  await Promise.resolve();
  expect(f.end).not.toHaveBeenCalled();
  expect(f.leave).not.toHaveBeenCalled();
  expect(f.runtime.getSnapshot().view).toMatchObject({
    self: { playerId: 'self', role: 'runner', status: 'ESCAPED' },
    knownTerrain: [],
    visibleEntities: [],
  });
  f.state({ stateVersion: 11, counts: { escaped: 2, captured: 0 }, phase: 'RESULT' });
  expect(f.runtime.getSnapshot().round?.counts.escaped).toBe(2);
  await vi.waitFor(() => expect(f.end).toHaveBeenCalledOnce());
  await f.runtime.leave();
  expect(f.leave).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledOnce();
});
it('keeps media and the projected view while spectating, then ends at the round result', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING', stateVersion: 11 });
  f.messages.get('private-view')!(
    viewFixture({
      stateVersion: 11,
      self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
      spectating: {
        targetId: 'runner-a',
        cell: { x: 7, y: 8 },
        dir: 2,
        action: null,
        candidates: ['runner-a', 'runner-b'],
      },
    }),
  );
  await Promise.resolve();

  expect(f.end).not.toHaveBeenCalled();
  expect(f.runtime.getSnapshot().view?.spectating?.targetId).toBe('runner-a');
  expect(f.fake.setAudioOutputLock).toHaveBeenLastCalledWith('open');
  expect(f.runtime.send({ type: 'SPECTATE', payload: { targetPlayerId: 'runner-b' } })).not.toBe(
    '',
  );
  expect(f.runtime.send({ type: 'SPECTATE', payload: { targetPlayerId: 'foreign' } })).toBe('');
  expect(f.send.mock.calls.filter(([channel]) => channel === 'command').at(-1)?.[1]).toMatchObject({
    type: 'SPECTATE',
    payload: { targetPlayerId: 'runner-b' },
  });

  f.state({ phase: 'RESULT', stateVersion: 12 });
  await vi.waitFor(() => expect(f.end).toHaveBeenCalledOnce());
});
it('keeps local sound preferences across rematch, prunes departed players and resets on room loss', async () => {
  const f = fixture();
  const roster = (matchId: string, stateVersion: number, ids: string[]) => ({
    matchId,
    stateVersion,
    phase: 'DEVICE_CHECK',
    hostId: 'self',
    players: ids.map((playerId) => ({
      playerId,
      nickname: playerId,
      ready: false,
      connected: true,
    })),
  });
  f.messages.get('room-roster')!(roster('m', 10, ['self', 'friend-a', 'friend-b']));
  f.runtime.setAudioPreferences({
    volume: 0.3,
    muted: false,
    mutedPlayerIds: ['self', 'friend-a', 'friend-a', 'unknown'],
  });
  expect(f.runtime.getLocalAudioStatus().preferences).toEqual({
    volume: 0.3,
    muted: false,
    mutedPlayerIds: ['friend-a'],
  });
  f.state({ phase: 'RESULT', stateVersion: 11 });
  await Promise.resolve();
  vi.mocked(f.fake.setAudioPreferences).mockClear();
  f.state({ matchId: 'new', phase: 'DEVICE_CHECK', stateVersion: 0 });
  await vi.waitFor(() =>
    expect(f.fake.setAudioPreferences).toHaveBeenCalledWith({
      volume: 0.3,
      muted: false,
      mutedPlayerIds: ['friend-a'],
    }),
  );
  f.messages.get('room-roster')!(roster('new', 0, ['self', 'friend-b']));
  expect(f.runtime.getLocalAudioStatus().preferences.mutedPlayerIds).toEqual([]);
  expect(f.runtime.getLocalAudioStatus().preferences.volume).toBe(0.3);
  f.close();
  f.runtime.setAudioPreferences({ volume: 1, muted: false, mutedPlayerIds: ['friend-b'] });
  expect(f.runtime.getLocalAudioStatus().preferences).toEqual(DEFAULT_AUDIO_PREFERENCES);
  await f.runtime.leave();
});

it('recreates a disposed runtime for new match and rejects old view and command events', async () => {
  const f = fixture();
  f.state({ phase: 'RESULT', stateVersion: 11 });
  await Promise.resolve();
  f.state({ matchId: 'new', phase: 'DEVICE_CHECK', stateVersion: 0 });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.runtime.getSnapshot().endedSelf).toBeNull();
  f.messages.get('private-view')!(viewFixture({ stateVersion: 500 }));
  expect(f.runtime.getSnapshot().view).toBeNull();
  await f.runtime.leave();
});

it('reapplies the selected low quality to every new runtime across three rematches', async () => {
  const f = fixture();
  try {
    f.runtime.quality('low');
    const initial = vi.mocked(f.fake.setQualityPreset).mock.calls.length;
    for (let i = 0; i < 3; i++) {
      f.state({ matchId: i === 0 ? 'm' : `rematch-${i}`, phase: 'RESULT', stateVersion: 11 });
      f.state({ matchId: `rematch-${i + 1}`, phase: 'DEVICE_CHECK', stateVersion: 0 });
      await vi.waitFor(() =>
        expect(f.fake.setQualityPreset).toHaveBeenCalledTimes(initial + i + 1),
      );
      expect(f.fake.setQualityPreset).toHaveBeenLastCalledWith('low');
      expect(f.runtime.getSnapshot().quality).toBe('low');
      f.runtime.quality('low');
      expect(f.fake.setQualityPreset).toHaveBeenCalledTimes(initial + i + 1);
    }
  } finally {
    await f.runtime.leave();
  }
});

it('reports and retires an empty face publication without requesting bindings', async () => {
  const f = await mediaFixture({ missingFace: true });
  await vi.waitFor(() =>
    expect(f.runtime.getSnapshot().error).toContain('FACE_PUBLICATION_MISSING'),
  );
  expect(f.requests()).toContainEqual(
    expect.objectContaining({
      url: MEDIA_ROUTES.report,
      body: expect.objectContaining({ status: 'failed' }),
    }),
  );
  expect(f.fake.retireMediaGeneration).toHaveBeenCalled();
  expect(f.send.mock.calls.some(([type]) => type === 'media-bindings-refresh')).toBe(false);
  f.close();
});

it('feeds the opt-in collector with match boundaries, sensors, media states and face tracks', () => {
  let clock = 1000;
  const metrics = createRuntimeMetrics({ now: () => clock });
  const f = fixture(undefined, metrics);
  const scope = { matchId: 'm', mediaInstanceId: 'mi-1', receiverGeneration: 1 };

  // Binding already opened a bucket for the room's current match.
  expect(metrics.report().matches.map((entry) => entry.matchId)).toEqual(['m']);
  f.state({ matchId: 'm', phase: 'PLAYING', stateVersion: 10 });
  f.callbacks.onMediaStatus({ ...scope, state: 'connected', code: null });
  clock = 1200;
  f.callbacks.onSensors({
    runtimeGeneration: 1,
    emittedAtMs: 1200,
    face: { frameId: 4, sampledAtMs: 1100, receivedAtMs: 1160, status: 'missing', data: null },
    pose: null,
    gesture: null,
  });
  f.callbacks.onFaceTrack({
    ...scope,
    playerId: 'friend',
    publisherGeneration: 1,
    trackSid: 'TR_1',
    // The node suite has no DOM; the runtime only needs a non-null element here.
    element: {} as HTMLVideoElement,
  });
  clock = 1500;
  f.state({ matchId: 'm', phase: 'RESULT', stateVersion: 11 });

  const [match] = metrics.report().matches;
  expect(match?.matchId).toBe('m');
  expect(match?.endedAtMs).toBe(1500);
  expect(match?.inference.face).toMatchObject({ count: 1, max: 60 });
  expect(match?.media.map((event) => event.kind)).toEqual(['state', 'face-track-attached']);
  // A rematch opens its own bucket instead of extending the finished one.
  f.state({ matchId: 'm-2', phase: 'DEVICE_CHECK', stateVersion: 12 });
  expect(metrics.report().matches.map((entry) => entry.matchId)).toEqual(['m', 'm-2']);
});

it('keeps the normal runtime path when the run did not ask for measurements', () => {
  const f = fixture();
  f.state({ matchId: 'm', phase: 'PLAYING', stateVersion: 10 });
  f.callbacks.onSensors({
    runtimeGeneration: 1,
    emittedAtMs: 10,
    face: { frameId: 1, sampledAtMs: 0, receivedAtMs: 10, status: 'missing', data: null },
    pose: null,
    gesture: null,
  });
  // No collector was injected: the sensor path itself is untouched and there is
  // nothing to read back, because nothing was published for this run.
  expect(f.runtime.sensors?.face?.frameId).toBe(1);
});

it('names device failures, keeps cleanup failures off the screen and clears notices on phase change', async () => {
  const f = fixture();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    vi.mocked(f.fake.startDevices).mockRejectedValueOnce(new Error('NotAllowedError: denied'));
    await f.runtime.startDevices(false);
    expect(f.runtime.getSnapshot().error).toContain('카메라');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('장치 시작 실패: Error: NotAllowedError: denied'),
    );
    f.state({ phase: 'TEAM_PRACTICE', stateVersion: 11 });
    expect(f.runtime.getSnapshot().error).toBeNull();
    f.end.mockRejectedValueOnce(new Error('cleanup'));
    f.state({ phase: 'RESULT', stateVersion: 12 });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('경기 종료 뒤 미디어 정리 실패: Error: cleanup'),
      ),
    );
    expect(f.runtime.getSnapshot().error).toBeNull();
    // 뒷정리 실패는 화면에 알리지 않지만 leave() 는 그대로 실패를 전달한다(기존 계약).
    await expect(f.runtime.leave()).rejects.toThrow('cleanup');
  } finally {
    warn.mockRestore();
  }
});

it('publishes the device runtime face guidance once per change and clears it', async () => {
  const f = fixture();
  const changed = () => f.runtime.getSnapshot().faceGuidance ?? null;
  expect(changed()).toBeNull();
  const glare = { condition: 'glare' as const, message: '안경 반사가 보여요.', isNew: true };
  f.callbacks.onFaceGuidance!(glare);
  const first = f.runtime.getSnapshot();
  expect(changed()).toEqual(glare);
  // The same notice again (isNew false) keeps the snapshot object, so screens do not re-render.
  f.callbacks.onFaceGuidance!({ ...glare, isNew: false });
  expect(f.runtime.getSnapshot()).toBe(first);
  f.callbacks.onFaceGuidance!({
    condition: 'backlit',
    message: '조명을 등지지 마세요.',
    isNew: true,
  });
  expect(changed()?.condition).toBe('backlit');
  f.callbacks.onFaceGuidance!(null);
  expect(changed()).toBeNull();
  await f.runtime.leave();
});

it('keeps demo state for the running match and sends only listed scenarios', async () => {
  const f = fixture();
  try {
    f.state({ phase: 'PLAYING', stateVersion: 5 });
    const matchId = f.runtime.getSnapshot().round!.matchId;
    const demo = {
      matchId,
      available: [
        { id: 'trap', options: [] },
        { id: 'capture', options: [] },
      ],
      running: null,
      step: null,
      failureCode: null,
      operatorExit: null,
    };
    // A message for another match is not this room's demo state.
    f.messages.get('demo-state')!({ ...demo, matchId: 'other-match' });
    expect(f.runtime.getSnapshot().demo).toBeUndefined();
    f.messages.get('demo-state')!(demo);
    expect(f.runtime.getSnapshot().demo).toMatchObject({
      available: [
        { id: 'trap', options: [] },
        { id: 'capture', options: [] },
      ],
    });
    f.runtime.runDemoScenario('trap');
    expect(f.send.mock.calls.filter(([channel]) => channel === 'demo-scenario')).toEqual([
      ['demo-scenario', { matchId, scenario: 'trap' }],
    ]);
  } finally {
    await f.runtime.leave();
  }
});

it('in a demo room skips media grants and reports LOAD_READY from assets and the initial view alone', async () => {
  const f = fixture();
  try {
    // 서버는 입장 직후, 경기 전에 demo-state 를 보낸다.
    f.state({ phase: 'DEVICE_CHECK', stateVersion: 11 });
    const matchId = f.runtime.getSnapshot().round!.matchId;
    f.messages.get('demo-state')!({
      matchId,
      available: [{ id: 'trap', options: [] }],
      running: null,
      step: null,
      failureCode: null,
      operatorExit: null,
    });
    // 연습: 데모 방은 미디어 발급을 요청하지 않는다(요청하면 NOT_READY 로 거절돼 오류만 남는다).
    f.state({ phase: 'TEAM_PRACTICE', stateVersion: 12 });
    f.messages.get('private-view')!(
      viewFixture({
        stateVersion: 12,
        gameScope: { kind: 'practice', revision: 1, gameInstanceId: 'practice' },
      }),
    );
    f.time(200);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.runtime.getSnapshot().error).toBeNull();
    // 로딩: 카메라 연결·얼굴 게시 없이 자산과 초기 화면만으로 보고한다.
    f.state({ phase: 'GAME_LOADING', stateVersion: 13 });
    const view = viewFixture({ stateVersion: 13 });
    if (view.self?.status !== 'ACTIVE') throw new Error();
    f.messages.get('private-view')!({
      ...view,
      self: {
        ...view.self,
        loading: {
          loadId: 'load-1',
          initialViewVersion: 13,
          mediaInstanceId: 'media-demo',
          receiverGeneration: 0,
          assetVersion: 'c-primitives-1',
        },
      },
    });
    f.time(400);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.runtime.getSnapshot().loadingPending ?? []).toEqual([]);
    const loadReady = f.send.mock.calls.filter(
      ([channel, value]) =>
        channel === 'command' && (value as { type: string }).type === 'LOAD_READY',
    );
    expect(loadReady).toHaveLength(1);
    expect((loadReady[0]![1] as { payload: unknown }).payload).toEqual({
      loadId: 'load-1',
      mediaInstanceId: 'media-demo',
      receiverGeneration: 0,
    });
  } finally {
    await f.runtime.leave();
  }
});

// S15P21C204-313. 데모 방의 "장치 점검 없이 준비 완료"는 카메라 없이 READY 를 보내야 한다(D3).
// 전에는 단추만 있고 브리지가 장치 미준비로 조용히 거절해 관리자가 대기 화면에 갇혔다.
it('sends READY without a device check only in a demo room', async () => {
  const f = fixture();
  try {
    f.state({ phase: 'DEVICE_CHECK', stateVersion: 11 });
    f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
    const readies = () =>
      f.send.mock.calls.filter(
        ([channel, value]) => channel === 'command' && (value as { type: string }).type === 'READY',
      );
    // 일반 방: 장치가 준비되지 않았으면 여전히 막고, 모드도 바꾸지 않는다.
    expect(f.runtime.ready(true)).toBe(false);
    expect(f.runtime.getSnapshot().interaction.mode).toBe('motion');
    expect(readies()).toHaveLength(0);

    f.messages.get('demo-state')!({
      matchId: f.runtime.getSnapshot().round!.matchId,
      available: [],
      running: null,
      step: null,
      failureCode: null,
      operatorExit: null,
    });
    // S15P21C204-384. 들어올 때는 일반 방처럼 모션 그대로다. 점검 없이 준비한 관리자만 키보드다.
    expect(f.runtime.getSnapshot().interaction.mode).toBe('motion');
    expect(f.runtime.ready(true)).toBe(true);
    expect(f.runtime.getSnapshot().interaction.mode).toBe('keyboard');
    expect(readies()).toHaveLength(1);
    expect((readies()[0]![1] as { payload: unknown }).payload).toEqual({ ready: true });
  } finally {
    await f.runtime.leave();
  }
});

it('keeps a demo-state that arrives before the first round until the round confirms its match', async () => {
  const room: ProductRoomPort = {
    state: { matchId: '' } as unknown as PublicMatchState,
    send: vi.fn(),
    leave: vi.fn(async () => {}),
    onMessage: (type, handler) => {
      messages.set(type, handler);
      return () => messages.delete(type);
    },
    onStateChange: (handler) => {
      stateHandler = handler;
      return vi.fn();
    },
    onLeave: () => vi.fn(),
    onError: () => vi.fn(),
  };
  const messages = new Map<string, (value: unknown) => void>();
  let stateHandler!: (state: PublicMatchState) => void;
  const runtime = bindProductRoom(
    room,
    {
      sessionToken: 'private',
      playerId: 'self',
      roomCode: 'ABCDEF',
      expiresAt: 1900000000000,
      protocolVersion: '0.2.0',
    },
    {
      now: () => 0,
      uuid: () => '10000000-0000-4000-8000-000000000000',
      changed: vi.fn(),
      interactionFactory: () => fixture().fake,
    },
  );
  try {
    const demo = {
      matchId: 'm',
      available: [{ id: 'trap', options: [] }],
      running: null,
      step: null,
      failureCode: null,
      operatorExit: null,
    };
    // 첫 상태 패치보다 먼저 온 demo-state 는 버리지 않고 들고 있다.
    messages.get('demo-state')!(demo);
    expect(runtime.getSnapshot().demo).toBeUndefined();
    stateHandler(roundFixture({ phase: 'LOBBY', stateVersion: 1 }) as unknown as PublicMatchState);
    expect(runtime.getSnapshot().demo).toMatchObject({
      matchId: 'm',
      available: [{ id: 'trap', options: [] }],
    });
  } finally {
    await runtime.leave();
  }
});

it('plays state cues once, defers count cues behind my own ending and flashes the screen', () => {
  const f = fixture();
  const played = () => vi.mocked(f.fake.playCue!).mock.calls.map(([kind]) => kind);
  const view = viewFixture();
  f.state({ phase: 'PLAYING', stateVersion: 11, counts: { escaped: 0, captured: 0 } });
  f.messages.get('private-view')!({ ...view, stateVersion: 11 });
  expect(played()).toEqual([]);
  const event = (type: string, payload: unknown, eventId: string) => ({
    matchId: 'm',
    gameScope: view.gameScope,
    eventId,
    tick: 100,
    stateVersion: 11,
    type,
    payload,
  });
  f.messages.get('private-event')!(
    event('EXCHANGE_OFFER', { exchangeId: 'x', fromPlayerId: 'friend', expiresAtTick: 140 }, 'e1'),
  );
  f.messages.get('private-event')!(
    event('EXIT_CHALLENGE_ENDED', { challengeId: 'c', result: 'failed', reason: null }, 'e2'),
  );
  f.messages.get('private-event')!(
    event('EXIT_CHALLENGE_ENDED', { challengeId: 'c', result: 'canceled', reason: null }, 'e3'),
  );
  expect(played()).toEqual(['exchange-offer', 'exit-failed']);
  expect(f.runtime.getSnapshot().cueFlash).toMatchObject({ kind: 'exit-failed' });
  const flashId = f.runtime.getSnapshot().cueFlash!.id;
  // 아군 탈출은 잠시 미룬 뒤 낸다.
  f.state({ phase: 'PLAYING', stateVersion: 12, counts: { escaped: 1, captured: 0 } });
  expect(played()).toHaveLength(2);
  f.time(300);
  expect(played()).toEqual(['exchange-offer', 'exit-failed', 'ally-progress']);
  // 라운드 누계가 먼저 오고 내 포획이 뒤따르면 누계 안내음은 버리고 포획만 낸다.
  f.state({ phase: 'PLAYING', stateVersion: 13, counts: { escaped: 1, captured: 1 } });
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  f.messages.get('private-view')!({
    ...view,
    stateVersion: 13,
    self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
  });
  f.time(700);
  expect(played()).toEqual(['exchange-offer', 'exit-failed', 'ally-progress', 'captured']);
  expect(f.runtime.getSnapshot().cueFlash).toMatchObject({ kind: 'captured' });
  expect(f.runtime.getSnapshot().cueFlash!.id).toBeGreaterThan(flashId);
  // 종료된 뒤에도 팀 결과는 듣고, 같은 결과를 두 번 내지 않는다.
  f.state({
    phase: 'RESULT',
    stateVersion: 14,
    counts: { escaped: 1, captured: 2 },
    result: { winner: 'taggers', reason: 'two-captured' },
  });
  f.state({
    phase: 'RESULT',
    stateVersion: 15,
    counts: { escaped: 1, captured: 2 },
    result: { winner: 'taggers', reason: 'two-captured' },
  });
  expect(played().slice(4)).toEqual(['defeat']);
  // 새 경기에서는 이전 경기와 비교하지 않는다.
  f.state({
    matchId: 'next',
    phase: 'LOBBY',
    stateVersion: 0,
    counts: { escaped: 0, captured: 0 },
  });
  expect(played()).toHaveLength(5);
});

// S15P21C204-334. 끝까지 남은 생존자는 결과 전이에서 개인 뷰가 비워져 역할을 잃는다.
it.each([
  ['runner', 'runners', 'victory', '승리'],
  ['runner', 'taggers', 'defeat', '패배'],
  ['tagger', 'taggers', 'victory', '승리'],
] as const)(
  'plays a surviving %s the %s result instead of an abort once the view is emptied at RESULT',
  (role, winner, cue, text) => {
    const f = fixture();
    const played = () => vi.mocked(f.fake.playCue!).mock.calls.map(([kind]) => kind);
    const view = viewFixture();
    if (view.self?.status !== 'ACTIVE') throw Error('active self required');
    f.state({ phase: 'PLAYING', stateVersion: 11, counts: { escaped: 0, captured: 0 } });
    f.messages.get('private-view')!({ ...view, stateVersion: 11, self: { ...view.self, role } });
    expect(f.runtime.getSnapshot().view?.self?.role).toBe(role);
    f.state({
      phase: 'RESULT',
      stateVersion: 12,
      counts: { escaped: 1, captured: 1 },
      result: { winner, reason: 'timeout' },
    });
    // 단계 전이로 개인 뷰는 비워졌지만 승패 안내음은 그대로 나온다.
    expect(f.runtime.getSnapshot().view).toBeNull();
    expect(f.runtime.getSnapshot().endedSelf).toBeNull();
    expect(played()).toEqual([cue]);
    const texts = f.runtime.getSnapshot().events.map((event) => event.text);
    expect(texts).toContain(text);
    expect(texts).not.toContain('경기 무효');
    // 뒤늦게 도착한 빈 뷰가 같은 결과를 다시 내지 않는다.
    f.messages.get('private-view')!({
      ...view,
      stateVersion: 12,
      gameScope: { gameInstanceId: null, kind: 'none', revision: 4 },
      self: null,
      knownTerrain: [],
      knownActiveExits: [],
      visibleCells: [],
      visibleWallFaces: [],
      visibleEntities: [],
    });
    expect(played()).toEqual([cue]);
  },
);

it('shows a server-confirmed capture flash to an active tagger', () => {
  const f = fixture();
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error('active self required');
  f.state({ phase: 'PLAYING', stateVersion: 11, counts: { escaped: 0, captured: 0 } });
  f.messages.get('private-view')!({
    ...view,
    stateVersion: 11,
    self: { ...view.self, role: 'tagger' },
  });

  f.state({ phase: 'PLAYING', stateVersion: 12, counts: { escaped: 0, captured: 1 } });

  expect(f.runtime.getSnapshot().cueFlash).toMatchObject({ kind: 'capture-success' });
});

it('flashes server-approved sensor and trap effects once without touching footsteps or my own cues', async () => {
  const f = await mediaFixture();
  f.state({ phase: 'GAME_LOADING', stateVersion: 11 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
  await vi.waitFor(() => expect(f.fake.publishMedia).toHaveBeenCalledTimes(2));
  f.state({ phase: 'PLAYING', stateVersion: 12 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 12 }));
  const media = f.runtime.getSnapshot().media!;
  let policyRevision = 0;
  const effect = (eventId: string, kind: 'footstep' | 'sensor' | 'trap') => ({
    eventId,
    kind,
    gain: 0.5,
    azimuthRad: 0,
    lowpassHz: 8000,
    tick: 100,
  });
  const policy = (effects: ReturnType<typeof effect>[]) =>
    f.messages.get('audio-policy')!({
      matchId: media.matchId,
      mediaInstanceId: media.mediaInstanceId,
      receiverGeneration: media.receiverGeneration,
      policyRevision: ++policyRevision,
      bindingRevision: 1,
      stateVersion: 12,
      voices: [],
      effects,
    });
  const flash = () => f.runtime.getSnapshot().cueFlash ?? null;
  // 발소리는 소리만 낸다. 한 칸마다 화면이 번쩍이면 안 된다.
  policy([effect('ev-1', 'footstep')]);
  expect(flash()).toBeFalsy();
  // 감지기는 화면으로도 알리고, 같은 eventId 가 다시 와도 한 번만 낸다.
  policy([effect('ev-2', 'sensor')]);
  expect(flash()).toMatchObject({ kind: 'sensor' });
  const sensorFlashId = flash()!.id;
  policy([effect('ev-2', 'sensor'), effect('ev-1', 'footstep')]);
  expect(flash()!.id).toBe(sensorFlashId);
  // 자기 구속 플래시는 더 구체적이므로 같은 순간의 덫 효과음이 덮지 않는다.
  f.time(2000);
  f.state({ phase: 'PLAYING', stateVersion: 13 });
  f.messages.get('private-view')!({
    ...viewFixture({ stateVersion: 13 }),
    self: { ...viewFixture().self!, restraintUntilTick: 140 },
  });
  expect(flash()).toMatchObject({ kind: 'restrained' });
  const restrainedFlashId = flash()!.id;
  policy([effect('ev-3', 'trap')]);
  expect(flash()!.id).toBe(restrainedFlashId);
  // 플래시가 지나간 뒤의 새 발동은 다시 화면으로 알린다.
  f.time(4000);
  policy([effect('ev-4', 'trap')]);
  expect(flash()).toMatchObject({ kind: 'trap' });
  expect(flash()!.id).toBeGreaterThan(restrainedFlashId);
  await f.runtime.leave();
});

it('S15P21C204-363: reports a showcase room closed by its host apart from expiry and removal', async () => {
  const f = fixture();
  f.close(4003);
  expect(f.runtime.getSnapshot()).toMatchObject({
    lost: true,
    showcaseClosed: true,
    removedByHost: false,
    roomExpired: false,
  });
  await vi.waitFor(() => expect(f.end).toHaveBeenCalledOnce());
});
