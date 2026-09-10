import { expect, it, vi } from 'vitest';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import type {
  InteractionContext,
  InteractionDeps,
  InteractionRuntime,
} from '../features/input/InteractionRuntime';
import { bindProductRoom, type ProductRoomPort } from './product-runtime';
import { roundFixture, viewFixture } from '../features/room/product-fixture';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
import { MEDIA_ROUTES } from '@kkakkung/protocol/game-messages';
function fixture() {
  let now = 0;
  let sequence = 0;
  const messages = new Map<string, (value: unknown) => void>();
  let stateHandler!: (state: PublicMatchState) => void;
  let leaveHandler!: () => void;
  const context = vi.fn<(context: InteractionContext) => void>();
  const end = vi.fn(async () => {});
  const dispose = vi.fn(async () => {});
  let callbacks!: InteractionDeps;
  const fake: InteractionRuntime = {
    setContext: context,
    endParticipation: end,
    dispose,
    startDevices: vi.fn(async () => INITIAL_DEVICES),
    calibrate: vi.fn(async () => INITIAL_DEVICES),
    connectMedia: vi.fn(async () => {}),
    applyAudioPolicy: vi.fn(),
    applyMediaBindings: vi.fn(),
    setQualityPreset: vi.fn(),
    retireMediaGeneration: vi.fn(async () => {}),
    beginMediaGeneration: vi.fn(),
    getGenerationState: () => 'live',
    publishMedia: vi.fn(async () => null),
    getPublications: () => [],
    addRemoteTrack: vi.fn(),
    removeRemoteTrack: vi.fn(),
    setAudioOutputLock: vi.fn(),
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
        return fake;
      },
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
    close: () => leaveHandler(),
    time: (value: number) => {
      now = value;
      runtime.poll();
    },
  };
}
async function mediaFixture(options: { failInitial?: boolean } = {}) {
  const f = fixture();
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
it('keeps Room for personal result but removes scene immediately and later leaves independently', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(
    viewFixture({ self: { playerId: 'self', role: 'runner', status: 'ESCAPED' } }),
  );
  await Promise.resolve();
  expect(f.end).toHaveBeenCalledOnce();
  expect(f.leave).not.toHaveBeenCalled();
  expect(f.runtime.getSnapshot().view).toBeNull();
  f.state({ stateVersion: 11, counts: { escaped: 2, captured: 0 }, phase: 'RESULT' });
  expect(f.runtime.getSnapshot().round?.counts.escaped).toBe(2);
  await f.runtime.leave();
  expect(f.leave).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledOnce();
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
