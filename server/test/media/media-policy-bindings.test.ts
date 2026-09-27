import { createHash } from 'node:crypto';
import {
  AccessToken,
  ParticipantInfo,
  Room,
  TrackInfo,
  TrackSource,
  TrackType,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { LiveKitGateway, type GatewayClient } from '../../src/media/LiveKitGateway.js';
import {
  MediaGenerationRegistry,
  type Generation,
} from '../../src/media/MediaGenerationRegistry.js';
import {
  MediaPolicyBindings,
  type MediaPolicyBindingsOptions,
} from '../../src/media/MediaPolicyBindings.js';
import type { MediaBindings, TrustedMediaFrame } from '../../src/media/types.js';

const config = {
  httpUrl: 'https://synthetic.invalid',
  apiKey: 'local-policy-test',
  apiSecret: 'local-synthetic-policy-secret',
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function frame(players = 2, patch: Partial<TrustedMediaFrame> = {}): TrustedMediaFrame {
  return {
    matchId: 'match',
    mediaInstanceId: 'game',
    instancePurpose: 'game',
    frameRevision: 1,
    tick: 1,
    phase: 'PLAYING',
    topology: {
      topologyVersion: 'v1',
      width: 10,
      height: 1,
      walkable: Array.from({ length: 10 }, () => true),
    },
    participants: Array.from({ length: players }, (_, index) => ({
      playerId: `p${index + 1}`,
      role: 'runner',
      status: 'ACTIVE',
      cell: { x: index, y: 0 },
      dir: 0,
      action: null,
    })),
    events: [],
    ...patch,
  };
}

function publication(generation: Generation, tracks = true): ParticipantInfo {
  return new ParticipantInfo({
    identity: generation.identity,
    sid: `PA_${generation.request.playerId}_${generation.generation}`,
    tracks: tracks
      ? [
          new TrackInfo({
            sid: `FACE_${generation.request.playerId}_${generation.generation}`,
            source: TrackSource.CAMERA,
            type: TrackType.VIDEO,
          }),
          new TrackInfo({
            sid: `AUDIO_${generation.request.playerId}_${generation.generation}`,
            source: TrackSource.MICROPHONE,
            type: TrackType.AUDIO,
          }),
        ]
      : [],
  });
}

function setup(players = 2, extra: Partial<MediaPolicyBindingsOptions> = {}) {
  let now = 0;
  const registry = new MediaGenerationRegistry('policy-test');
  const initialFrame = frame(players);
  registry.observe(initialFrame);
  const generations = initialFrame.participants.map((player) =>
    registry.allocate(
      {
        requestId: `prepare-${player.playerId}`,
        matchId: 'match',
        mediaInstanceId: 'game',
        purpose: 'game',
        playerId: player.playerId,
        expectedPreviousGeneration: null,
      },
      1_000_000,
    ),
  );
  const participants = new Map(
    generations.map((generation) => [generation.identity, publication(generation)]),
  );
  const getParticipant = vi.fn(
    async (_room: string, identity: string): Promise<ParticipantInfo> => {
      const current = participants.get(identity);
      if (!current) throw { code: 'not_found', status: 404 };
      return current;
    },
  );
  const updateSubscriptions = vi.fn(
    async (
      _room: string,
      _identity: string,
      _tracks: string[],
      _subscribe: boolean,
    ): Promise<void> => undefined,
  );
  const client: GatewayClient = {
    forwardParticipant: async () => {
      throw new Error('UNEXPECTED_FORWARD_IN_LEGACY_FIXTURE');
    },
    createRoom: vi.fn(async () => new Room()),
    listRooms: vi.fn(async () => []),
    listParticipants: vi.fn(async () => []),
    getParticipant,
    updateSubscriptions,
    updateParticipant: vi.fn(async () => new ParticipantInfo()),
    removeParticipant: vi.fn(async () => undefined),
    deleteRoom: vi.fn(async () => undefined),
  };
  const budget = new ApiBudget({
    monotonicNow: () => now,
    maxNormalCallsPer60s: 600,
    maxTotalCallsPer60s: 900,
  });
  const gateway = new LiveKitGateway(config, budget, {
    monotonicNow: () => now,
    clientFactory: () => client,
  });
  const enqueueBindings = vi.fn<MediaPolicyBindingsOptions['enqueueBindings']>();
  const enqueueAudioPolicy = vi.fn<MediaPolicyBindingsOptions['enqueueAudioPolicy']>();
  const onFailure = vi.fn<MediaPolicyBindingsOptions['onFailure']>();
  const binding = new MediaPolicyBindings({
    registry,
    gateway,
    config,
    monotonicNow: () => now,
    enqueueBindings,
    enqueueAudioPolicy,
    onFailure,
    emitMetric: vi.fn(),
    isPermissionsAllowed: () => true,
    ...extra,
  });
  binding.observeFrame(initialFrame);
  for (const generation of generations) binding.register(generation);
  cleanups.push(() => {
    binding.close();
    budget.close();
  });
  return {
    binding,
    budget,
    registry,
    initialFrame,
    generations,
    participants,
    getParticipant,
    updateSubscriptions,
    enqueueBindings,
    enqueueAudioPolicy,
    onFailure,
    time: (value: number) => {
      now = value;
    },
  };
}

async function settle() {
  for (let count = 0; count < 60; count++) await Promise.resolve();
}
async function signed(generation: Generation, id = 'event') {
  const rawBody = JSON.stringify({
    event: 'track_published',
    id,
    createdAt: '1',
    room: { name: generation.roomName },
    participant: { identity: generation.identity },
  });
  const token = new AccessToken(config.apiKey, config.apiSecret, { ttl: 60 });
  token.sha256 = createHash('sha256').update(rawBody).digest('base64');
  return { rawBody, authorization: await token.toJwt() };
}

describe('actual E policy and track bindings composition with synthetic Cloud transport', () => {
  it('notifies remote retirement when readiness is lost rather than abandoning active permissions', async () => {
    let allowed = true;
    const s = setup(2, { isPermissionsAllowed: () => allowed });
    await s.binding.reconcile();
    await settle();
    const before = s.updateSubscriptions.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    allowed = false;
    await s.binding.reconcile();
    await settle();
    expect(s.onFailure).toHaveBeenCalledTimes(2);
    for (const generation of s.generations)
      expect(s.onFailure).toHaveBeenCalledWith(generation, 'POLICY_UNKNOWN');
    allowed = true;
    s.binding.observeFrame(frame(2, { frameRevision: 2 }));
    await s.binding.reconcile();
    await settle();
    expect(s.updateSubscriptions).toHaveBeenCalledTimes(before);
    expect(s.onFailure).toHaveBeenCalledTimes(2);
  });

  it("does not evaluate other rooms' generation permissions while publishing one room", () => {
    const isPermissionsAllowed = vi.fn((_generation: Generation) => true);
    const s = setup(2, { isPermissionsAllowed });
    const otherFrame = frame(2, { matchId: 'other' });
    s.registry.observe(otherFrame);
    const others = otherFrame.participants.map((player) =>
      s.registry.allocate(
        {
          requestId: `other-${player.playerId}`,
          matchId: 'other',
          mediaInstanceId: 'game',
          purpose: 'game',
          playerId: player.playerId,
          expectedPreviousGeneration: null,
        },
        1_000_000,
      ),
    );
    s.binding.observeFrame(otherFrame);
    for (const generation of others) s.binding.register(generation);
    isPermissionsAllowed.mockClear();
    s.binding.observeFrame(frame(2, { frameRevision: 2 }));
    expect(isPermissionsAllowed).toHaveBeenCalled();
    expect(
      isPermissionsAllowed.mock.calls.every(
        ([generation]) => generation.request.matchId === 'match',
      ),
    ).toBe(true);
  });

  it('publishes only verified self and peer bindings, no internal positions, using one API budget', async () => {
    const s = setup();
    expect(s.updateSubscriptions).not.toHaveBeenCalled();
    expect(s.enqueueBindings.mock.calls.every(([, value]) => value.participants.length === 0)).toBe(
      true,
    );
    await s.binding.reconcile();
    await settle();
    const bindings = s.enqueueBindings.mock.calls.filter(([id]) => id === 'p1').at(-1)![1];
    expect(bindings).toMatchObject({
      matchId: 'match',
      mediaInstanceId: 'game',
      receiverGeneration: 1,
      participants: [
        { playerId: 'p1', publisherGeneration: 1, faceTrackSid: 'FACE_p1_1' },
        { playerId: 'p2', publisherGeneration: 1, audioTrackSid: 'AUDIO_p2_1' },
      ],
    });
    const audio = s.enqueueAudioPolicy.mock.calls.filter(([id]) => id === 'p1').at(-1)![1];
    expect(audio).toMatchObject({
      bindingRevision: bindings.bindingRevision,
      receiverGeneration: 1,
      voices: [{ playerId: 'p2', trackSid: 'AUDIO_p2_1' }],
    });
    expect(JSON.stringify([bindings, audio])).not.toMatch(/topology|walkable|"cell"/);
    expect(s.budget.getSnapshot().total60s).toBe(
      s.getParticipant.mock.calls.length + s.updateSubscriptions.mock.calls.length,
    );
    expect(
      s.updateSubscriptions.mock.calls
        .filter(([, identity]) => identity === s.generations[0]!.identity)
        .flatMap(([, , tracks]) => tracks),
    ).not.toContain('FACE_p1_1');
    expect(s.onFailure).not.toHaveBeenCalled();
  });

  it('preserves the other five receiver generations and increments binding revisions when one publisher reconnects', async () => {
    const s = setup(6);
    await s.binding.reconcile();
    await settle();
    const previous = new Map(
      s.generations.map((g) => [
        g.request.playerId,
        s.enqueueBindings.mock.calls.filter(([id]) => id === g.request.playerId).at(-1)![1],
      ]),
    );
    const retired = s.generations[1]!;
    s.binding.retire(retired);
    retired.terminal = true;
    retired.state = 'REVOKED';
    const replacement = s.registry.allocate(
      { ...retired.request, requestId: 'replace-p2', expectedPreviousGeneration: 1 },
      1_001_000,
    );
    s.participants.set(replacement.identity, publication(replacement));
    s.binding.register(replacement);
    await s.binding.reconcile();
    await settle();
    for (const g of s.generations.filter((g) => g !== retired)) {
      const latest = s.enqueueBindings.mock.calls
        .filter(([id]) => id === g.request.playerId)
        .at(-1)![1];
      expect(latest.receiverGeneration).toBe(1);
      expect(latest.bindingRevision).toBeGreaterThan(
        previous.get(g.request.playerId)!.bindingRevision,
      );
      expect(
        latest.participants.find((participant) => participant.playerId === 'p2'),
      ).toMatchObject({
        publisherGeneration: 2,
        mediaIdentity: replacement.identity,
        participantSid: 'PA_p2_2',
      });
      expect(s.registry.get('match', g.request.playerId)).toBe(g);
    }
    expect(
      s.enqueueBindings.mock.calls.filter(([id]) => id === 'p2').at(-1)![1].receiverGeneration,
    ).toBe(2);
  });

  it('discards an old query that resolves after retirement and replacement', async () => {
    const s = setup();
    const old = s.generations[0]!;
    let resolve!: (value: ParticipantInfo) => void;
    s.getParticipant.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = s.binding.reconcile();
    s.binding.retire(old);
    old.terminal = true;
    old.state = 'REVOKED';
    const replacement = s.registry.allocate(
      { ...old.request, requestId: 'replacement', expectedPreviousGeneration: 1 },
      1_001_000,
    );
    s.participants.set(replacement.identity, publication(replacement));
    s.binding.register(replacement);
    await pending;
    await s.binding.reconcile();
    await settle();
    const boundary = s.enqueueBindings.mock.calls.length;
    resolve(publication(old));
    await settle();
    expect(
      s.enqueueBindings.mock.calls
        .slice(boundary)
        .some(([, message]) => message.participants.some((p) => p.mediaIdentity === old.identity)),
    ).toBe(false);
    expect(s.binding.inspect(replacement)?.participantSid).toBe('PA_p1_2');
    expect(s.binding.inspect(old)).toBeNull();
  });

  it('revokes old microphone SIDs before authorizing a verified replacement without changing receiver generations', async () => {
    const s = setup();
    await s.binding.reconcile();
    await settle();
    const publisher = s.generations[1]!;
    const changed = publication(publisher);
    changed.tracks[1]!.sid = 'AUDIO_NEW';
    s.participants.set(publisher.identity, changed);
    s.time(5000);
    const event = await signed(publisher);
    await s.binding.handleWebhook(event.rawBody, event.authorization);
    await settle();
    const receiverCalls = s.updateSubscriptions.mock.calls.filter(
      ([, identity]) => identity === s.generations[0]!.identity,
    );
    const removal = receiverCalls.findIndex(
      ([, , tracks, subscribe]) => !subscribe && tracks.includes('AUDIO_p2_1'),
    );
    const addition = receiverCalls.findIndex(
      ([, , tracks, subscribe]) => subscribe && tracks.includes('AUDIO_NEW'),
    );
    expect(removal).toBeGreaterThanOrEqual(0);
    expect(addition).toBeGreaterThan(removal);
    expect(s.enqueueAudioPolicy.mock.calls.filter(([id]) => id === 'p1').at(-1)![1]).toMatchObject({
      receiverGeneration: 1,
      voices: [{ trackSid: 'AUDIO_NEW' }],
    });
  });

  it('does not emit new revisions for unchanged publications or equal/older frames', async () => {
    const s = setup();
    await s.binding.reconcile();
    await settle();
    const bindings = s.enqueueBindings.mock.calls.length;
    const audio = s.enqueueAudioPolicy.mock.calls.length;
    s.binding.observeFrame(s.initialFrame);
    s.binding.observeFrame({ ...s.initialFrame, frameRevision: 0 });
    s.time(30_000);
    await s.binding.reconcile();
    await settle();
    expect(s.enqueueBindings).toHaveBeenCalledTimes(bindings);
    expect(s.enqueueAudioPolicy).toHaveBeenCalledTimes(audio);
  });

  it('immediately reports permission uncertainty and never revives it from a late subscription response', async () => {
    const s = setup();
    let resolve!: () => void;
    s.updateSubscriptions.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await s.binding.reconcile();
    await settle();
    s.time(1000);
    await s.binding.reconcile();
    await settle();
    expect(s.onFailure).toHaveBeenCalledWith(expect.anything(), 'POLICY_UNKNOWN');
    const failed = s.onFailure.mock.calls[0]![0];
    const boundary = s.enqueueBindings.mock.calls.length;
    resolve();
    await settle();
    expect(s.binding.inspect(failed)).toBeNull();
    expect(
      s.enqueueBindings.mock.calls
        .slice(boundary)
        .some(([, bindings]) =>
          bindings.participants.some((p) => p.mediaIdentity === failed.identity),
        ),
    ).toBe(false);
  });

  it.each(['sid', 'source', 'extra-camera'])(
    'fails the offending generation for a verified invalid %s publication',
    async (failure) => {
      const s = setup();
      await s.binding.reconcile();
      await settle();
      const generation = s.generations[0]!;
      const invalid = publication(generation);
      if (failure === 'sid') invalid.sid = 'PA_REPLACED';
      if (failure === 'source') invalid.tracks[0]!.source = TrackSource.SCREEN_SHARE;
      if (failure === 'extra-camera')
        invalid.tracks.push(
          new TrackInfo({ sid: 'EXTRA', source: TrackSource.CAMERA, type: TrackType.VIDEO }),
        );
      s.participants.set(generation.identity, invalid);
      s.time(30_000);
      await s.binding.reconcile();
      await settle();
      expect(s.onFailure).toHaveBeenCalledExactlyOnceWith(generation, 'POLICY_UNKNOWN');
      expect(
        s.enqueueBindings.mock.calls
          .filter(([id]) => id === 'p2')
          .at(-1)![1]
          .participants.map((p) => p.playerId),
      ).not.toContain('p1');
    },
  );

  it('distinguishes a confirmed participant without tracks from remote absence in reconnect inspection', async () => {
    const s = setup(1);
    const generation = s.generations[0]!;
    s.participants.set(generation.identity, publication(generation, false));
    await s.binding.reconcile();
    expect(s.binding.inspect(generation)).toMatchObject({
      participantSid: 'PA_p1_1',
      lastVerifiedAt: 0,
      dirty: false,
      bindings: [],
    });
    s.participants.delete(generation.identity);
    s.time(30_000);
    await s.binding.reconcile();
    expect(s.binding.inspect(generation)).toMatchObject({
      participantSid: null,
      lastVerifiedAt: 30_000,
      bindings: [],
    });
    const replacement = publication(generation);
    replacement.sid = 'DIFFERENT';
    s.participants.set(generation.identity, replacement);
    s.time(60_000);
    await s.binding.reconcile();
    expect(s.onFailure).toHaveBeenCalledExactlyOnceWith(generation, 'POLICY_UNKNOWN');
  });

  it('closes without waiting for a hung query and consumes its late outcome safely', async () => {
    const s = setup(1);
    let resolve!: (participant: ParticipantInfo) => void;
    s.getParticipant.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = s.binding.reconcile();
    s.binding.close();
    await pending;
    const before = s.enqueueBindings.mock.calls.length;
    resolve(publication(s.generations[0]!));
    await settle();
    expect(s.enqueueBindings).toHaveBeenCalledTimes(before);
    expect(s.updateSubscriptions).not.toHaveBeenCalled();
    expect(s.budget.getSnapshot().closed).toBe(false);
  });

  it('ignores webhook completion after close, including a verifier that never settles', async () => {
    let resolve!: (event: WebhookEvent) => void;
    const verifier = {
      receive: vi.fn(
        () =>
          new Promise<WebhookEvent>((done) => {
            resolve = done;
          }),
      ),
    };
    const s = setup(1, { webhookVerifier: verifier });
    const pending = s.binding.handleWebhook('synthetic-event', 'synthetic-authorization');
    s.binding.close();
    await expect(pending).resolves.toEqual({ status: 'ignored' });
    resolve({
      id: 'late',
      event: 'track_published',
      room: new Room({ name: s.generations[0]!.roomName }),
      participant: publication(s.generations[0]!),
    } as WebhookEvent);
    await settle();
    expect(s.getParticipant).not.toHaveBeenCalled();
    await expect(s.binding.handleWebhook('', '')).resolves.toEqual({ status: 'ignored' });
  });

  it('rejects forged webhook bodies with the installed verifier and authenticates before a query', async () => {
    const s = setup(1);
    const event = await signed(s.generations[0]!);
    await expect(
      s.binding.handleWebhook(event.rawBody + ' ', event.authorization),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(s.getParticipant).not.toHaveBeenCalled();
    await expect(s.binding.handleWebhook(event.rawBody, event.authorization)).resolves.toEqual({
      status: 'accepted',
    });
    await expect(s.binding.handleWebhook(event.rawBody, event.authorization)).resolves.toEqual({
      status: 'ignored',
    });
    expect(s.getParticipant).toHaveBeenCalledOnce();
  });

  it('never lets a failing queue observer resurrect a locally retired publisher via reentrant binding emission', async () => {
    const messages: [string, MediaBindings][] = [];
    let armed = false;
    const s = setup(3, {
      enqueueBindings: (playerId, value) => {
        if (armed && playerId === 'p1' && value.participants.some((p) => p.playerId === 'p1'))
          throw new Error('synthetic queue failure');
        messages.push([playerId, value]);
      },
    });
    armed = true;
    await s.binding.reconcile();
    await settle();
    expect(s.onFailure).toHaveBeenCalledExactlyOnceWith(s.generations[0], 'POLICY_UNKNOWN');
    for (const id of ['p2', 'p3'])
      expect(
        messages
          .filter(([playerId]) => playerId === id)
          .at(-1)![1]
          .participants.map((p) => p.playerId),
      ).not.toContain('p1');
  });

  it('clones messages so a consumer mutation cannot change later bindings or subscription permissions', async () => {
    const s = setup(2, {
      enqueueBindings: (_playerId, value) => {
        const mutable = value.participants as unknown as { audioTrackSid?: string }[];
        for (const participant of mutable) participant.audioTrackSid = 'INJECTED';
      },
    });
    await s.binding.reconcile();
    await settle();
    expect(s.updateSubscriptions.mock.calls.flatMap(([, , tracks]) => tracks)).not.toContain(
      'INJECTED',
    );
    expect(
      s.enqueueAudioPolicy.mock.calls.flatMap(([, value]) =>
        value.voices.map((voice) => voice.trackSid),
      ),
    ).not.toContain('INJECTED');
  });

  it('requests a scoped reconnect reconciliation after the 5s query interval without waiting 30s', async () => {
    const s = setup();
    await s.binding.reconcile();
    await settle();
    s.binding.requestReconciliation(s.generations[0]!);
    s.time(4999);
    await s.binding.reconcile();
    expect(s.getParticipant).toHaveBeenCalledTimes(2);
    s.time(5000);
    await s.binding.reconcile();
    expect(s.getParticipant).toHaveBeenCalledTimes(3);
    expect(s.getParticipant.mock.calls.at(-1)![1]).toBe(s.generations[0]!.identity);
    s.binding.requestReconciliation(structuredClone(s.generations[1]!));
    s.binding.retire(s.generations[0]!);
    s.binding.requestReconciliation(s.generations[0]!);
    s.time(10_000);
    await s.binding.reconcile();
    expect(s.getParticipant).toHaveBeenCalledTimes(3);
  });
});

it('publisher permissions accepts a delayed allow while server-controlled keeps its 1s bound', async () => {
  for (const subscriptionMode of ['publisher-permissions', 'server-controlled'] as const) {
    const emitEvent = vi.fn();
    const s = setup(2, { config: { ...config, subscriptionMode }, emitEvent });
    const resolves: (() => void)[] = [];
    s.updateSubscriptions.mockImplementation(
      () => new Promise<void>((done) => resolves.push(done)),
    );
    await s.binding.reconcile();
    await settle();
    expect(resolves.length).toBeGreaterThan(0);
    s.time(1500);
    for (const resolve of resolves) resolve();
    await settle();
    if (subscriptionMode === 'publisher-permissions') expect(s.onFailure).not.toHaveBeenCalled();
    else {
      expect(s.onFailure).toHaveBeenCalled();
      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'media.policy.uncertain',
          fields: expect.objectContaining({ code: 'RESPONSE_TIMEOUT' }),
        }),
      );
    }
  }
});

/**
 * S15P21C204-404. A receiver that left the LiveKit room holds no subscriptions, so a policy change
 * that would block (or allow) a track for it must not become "permission state unknown". In
 * production a block sent to such a receiver answered 404 after 1,085ms, the 1s block deadline
 * fired first, and the POLICY_UNKNOWN locked the whole server's readiness until a restart.
 */
describe('a receiver that left the LiveKit room', () => {
  /** p1 stays at x=0; p2 moves to `x`. Past five cells p1 stops hearing p2 (a block). */
  function moved(x: number, frameRevision: number): TrustedMediaFrame {
    const base = frame(2, { frameRevision });
    return {
      ...base,
      participants: base.participants.map((p) =>
        p.playerId === 'p2' ? { ...p, cell: { x, y: 0 } } : p,
      ),
    };
  }
  /** LiveKit answers not_found for an identity that is not in the room, the way production did. */
  function absentAnswersNotFound(s: ReturnType<typeof setup>) {
    s.updateSubscriptions.mockImplementation(async (_room, identity) => {
      if (!s.participants.has(identity)) throw { code: 'not_found', status: 404 };
    });
  }
  function callsTo(s: ReturnType<typeof setup>, identity: string) {
    return s.updateSubscriptions.mock.calls.filter(([, target]) => target === identity);
  }

  it('changes its subscriptions without a remote call once its own lookup found it gone', async () => {
    const s = setup(2);
    absentAnswersNotFound(s);
    await s.binding.reconcile();
    await settle();
    const receiver = s.generations[0]!;
    expect(s.binding.inspect(receiver)).toMatchObject({ participantSid: 'PA_p1_1' });
    // p1's browser drops out of LiveKit; the 30s re-query sees it gone.
    s.participants.delete(receiver.identity);
    s.time(30_000);
    await s.binding.reconcile();
    await settle();
    expect(s.binding.inspect(receiver)).toMatchObject({ participantSid: null });
    const before = callsTo(s, receiver.identity).length;

    // p2 walks out of p1's hearing, then back in: a block, then an allow, for the absent p1.
    s.binding.observeFrame(moved(9, 2));
    await settle();
    s.time(31_500);
    await s.binding.reconcile();
    await settle();
    s.binding.observeFrame(moved(1, 3));
    await settle();
    s.time(33_000);
    await s.binding.reconcile();
    await settle();

    expect(callsTo(s, receiver.identity)).toHaveLength(before);
    expect(s.onFailure).not.toHaveBeenCalled();
  });

  it('treats a block answered not_found as confirmed before its own lookup noticed', async () => {
    const s = setup(2);
    absentAnswersNotFound(s);
    await s.binding.reconcile();
    await settle();
    const receiver = s.generations[0]!;
    // Gone from LiveKit, but no re-query has run yet: the block itself discovers it.
    s.participants.delete(receiver.identity);
    s.binding.observeFrame(moved(9, 2));
    await settle();
    expect(
      callsTo(s, receiver.identity).some(
        ([, , tracks, subscribe]) => !subscribe && tracks.includes('AUDIO_p2_1'),
      ),
    ).toBe(true);
    s.time(1500);
    await s.binding.reconcile();
    await settle();
    expect(s.onFailure).not.toHaveBeenCalled();
  });

  it('still fails a present receiver whose block is refused for another reason', async () => {
    const s = setup(2);
    await s.binding.reconcile();
    await settle();
    const receiver = s.generations[0]!;
    s.updateSubscriptions.mockImplementation(async (_room, identity, _tracks, subscribe) => {
      if (identity === receiver.identity && !subscribe) throw { code: 'unavailable', status: 503 };
    });
    s.binding.observeFrame(moved(9, 2));
    await settle();
    s.time(1500);
    await s.binding.reconcile();
    await settle();
    expect(s.onFailure).toHaveBeenCalledWith(receiver, 'POLICY_UNKNOWN');
  });

  it('fails a departed receiver that shows up again, since its remote state was not kept', async () => {
    const s = setup(2);
    absentAnswersNotFound(s);
    await s.binding.reconcile();
    await settle();
    const receiver = s.generations[0]!;
    s.participants.delete(receiver.identity);
    s.time(30_000);
    await s.binding.reconcile();
    await settle();
    s.binding.observeFrame(moved(9, 2));
    await settle();
    expect(s.onFailure).not.toHaveBeenCalled();
    // The same participant answers again (a transient 404, or a resumed session).
    s.participants.set(receiver.identity, publication(receiver));
    s.time(60_000);
    await s.binding.reconcile();
    await settle();
    expect(s.onFailure).toHaveBeenCalledExactlyOnceWith(receiver, 'POLICY_UNKNOWN');
  });
});
