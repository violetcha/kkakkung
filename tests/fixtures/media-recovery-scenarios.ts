// F-08..F-11 / QA-03..QA-06 fixture. E's real media modules (SubscriptionController,
// TrackRegistry, RetirementBarrier, MediaGenerationRegistry, GrantIssuer, GenerationTransition,
// RecoveryBootstrap, OperationJournal) driven by scripted adapters: every remote call is a
// deferred promise the test settles in the order it wants, the clock is a number the test moves.
// Nothing here talks to LiveKit; the Cloud halves live in tests/cloud/g1-*.cloud.test.ts.
import { randomUUID } from 'node:crypto';
import { TrackSource, TrackType } from 'livekit-server-sdk';
import { vi } from 'vitest';
import type { CapabilityReport } from '../../server/src/media/CloudCapabilityProbe.ts';
import {
  MediaGenerationRegistry,
  type Generation,
} from '../../server/src/media/MediaGenerationRegistry.ts';
import type { PolicyTimer } from '../../server/src/media/PolicyUncertainty.ts';
import {
  RetirementBarrier,
  type RetirementBarrierDeps,
} from '../../server/src/media/RetirementBarrier.ts';
import {
  SubscriptionController,
  type SubscriptionKey,
  type SubscriptionRequest,
} from '../../server/src/media/SubscriptionController.ts';
import {
  TrackRegistry,
  type RemoteParticipant,
  type TrackOwner,
} from '../../server/src/media/TrackRegistry.ts';
import type {
  MediaConfiguration,
  PrepareGenerationRequest,
  RetireGenerationRequest,
  TrustedMediaFrame,
} from '../../server/src/media/types.ts';

export const NAMESPACE = 'f-g1-fixture';
export const EPOCH_MS = 1_800_000_000_000;

/** Synthetic capability evidence for local orchestration only; never Cloud proof. */
export const capability: CapabilityReport = {
  status: 'SUPPORTED',
  sdkVersion: '2.18.0',
  cloudProjectAlias: 'local-fixture',
  namespace: NAMESPACE,
  testedAtEpochMs: EPOCH_MS,
  grantProfile: {
    roomJoin: true,
    room: 'probe-room',
    canPublishData: false,
    canSubscribe: false,
    canPublishSources: ['camera', 'microphone'],
    roomAdmin: false,
    roomRecord: false,
    roomCreate: false,
    roomList: false,
  },
  revocationProfile: { mode: 'explicit-cutoff', bufferSeconds: 2, maxObservedClockOffsetMs: 100 },
  allowReceived: true,
  forbiddenRejected: true,
  revocationVerified: true,
  evidenceRefs: ['synthetic-local-only-not-cloud-evidence'],
};

export function configuration(now = EPOCH_MS): MediaConfiguration {
  return {
    httpUrl: 'https://fixture.invalid',
    wsUrl: 'wss://fixture.invalid',
    apiKey: 'local-test-key',
    apiSecret: 'local-test-signing-secret-no-cloud-access',
    namespace: NAMESPACE,
    opsDataDir: '.local/unused-unit-path',
    projectAlias: 'local-fixture',
    publicWindow: { opensAtEpochMs: now - 1000, closesAtEpochMs: now + 600_000 },
    officialBudgetMaxAgeMs: 3_600_000,
    operationTimeoutMs: 1000,
    productSecurityReady: true,
    initialBudget: null,
    maxConcurrentParticipants: 6,
    maxNormalApiCallsPer60s: 600,
    maxTotalApiCallsPer60s: 900,
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export type Deferred<T = void> = ReturnType<typeof deferred<T>>;

/** Lets every queued microtask run; E's controllers schedule their sends on the microtask queue. */
export const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};

/** One game room frame with the given ACTIVE players standing in a row. */
export function gameFrame(
  players: readonly string[],
  patch: Partial<TrustedMediaFrame> = {},
): TrustedMediaFrame {
  return {
    matchId: 'm',
    mediaInstanceId: 'game',
    instancePurpose: 'game',
    frameRevision: 1,
    tick: 1,
    phase: 'PLAYING',
    topology: { topologyVersion: 'row', width: 8, height: 1, walkable: Array(8).fill(true) },
    participants: players.map((playerId, i) => ({
      playerId,
      role: i % 2 === 0 ? 'runner' : 'tagger',
      status: 'ACTIVE',
      cell: { x: i, y: 0 },
      dir: 1,
      action: null,
    })),
    events: [],
    ...patch,
  };
}

export function prepareRequest(
  playerId: string,
  patch: Partial<PrepareGenerationRequest> = {},
): PrepareGenerationRequest {
  return {
    requestId: `prepare-${playerId}-${patch.expectedPreviousGeneration ?? 0}`,
    matchId: 'm',
    playerId,
    mediaInstanceId: 'game',
    purpose: 'game',
    expectedPreviousGeneration: null,
    ...patch,
  };
}

export function receiverKey(playerId: string, generation: Generation): SubscriptionKey {
  return {
    matchId: generation.request.matchId,
    mediaInstanceId: generation.request.mediaInstanceId,
    receiverGeneration: generation.generation,
    playerId,
    mediaRoomName: generation.roomName,
    receiverIdentity: generation.identity,
  };
}

export function ownerOf(generation: Generation): TrackOwner {
  return {
    matchId: generation.request.matchId,
    mediaInstanceId: generation.request.mediaInstanceId,
    mediaRoomName: generation.roomName,
    playerId: generation.request.playerId,
    mediaIdentity: generation.identity,
    publisherGeneration: generation.generation,
  };
}

export function retireRequest(
  generation: Generation,
  reason: RetireGenerationRequest['reason'],
  requestId = `retire-${randomUUID()}`,
): RetireGenerationRequest {
  return {
    requestId,
    matchId: generation.request.matchId,
    mediaInstanceId: generation.request.mediaInstanceId,
    receiverGeneration: generation.generation,
    playerId: generation.request.playerId,
    reason,
  };
}

/** A registry with one game room and generations allocated for the given players. */
export function registryWith(players: readonly string[]) {
  const registry = new MediaGenerationRegistry(NAMESPACE);
  registry.observe(gameFrame(players));
  const generations = new Map<string, Generation>();
  for (const id of players) generations.set(id, registry.allocate(prepareRequest(id), EPOCH_MS));
  return { registry, generations, generation: (id: string) => generations.get(id)! };
}

/**
 * Real SubscriptionController with a scripted transport: every send becomes a deferred the test
 * settles (or never settles). Time is manual; `check()` runs the 1 s policy-uncertainty deadlines.
 */
export function subscriptionHarness(options: { tracks?: readonly string[] } = {}) {
  let now = 0;
  const validTracks = new Set(options.tracks ?? ['A', 'B', 'C']);
  const fingerprints = new Map<string, string>();
  const invalidKeys = new Set<string>();
  const sends: (SubscriptionRequest & Deferred & { dispatched: boolean; sentAt: number })[] = [];
  const unknown: { key: SubscriptionKey; requestId: string | null }[] = [];
  const late: {
    requestId: string;
    receiverGeneration: number;
    outcome: 'resolved' | 'rejected';
  }[] = [];
  const timer: PolicyTimer = () => () => undefined;
  const controller = new SubscriptionController({
    now: () => now,
    timer,
    validateKey: (key) => !invalidKeys.has(key.receiverIdentity),
    validateTrack: (_key, sid) => validTracks.has(sid),
    getTrackFingerprint: (_key, sid) =>
      validTracks.has(sid) ? (fingerprints.get(sid) ?? `${sid}:1`) : null,
    onUnknown: (key, requestId) => unknown.push({ key, requestId }),
    onLateResponse: (input) => late.push(input),
    send: (request) => {
      const pending = deferred();
      const dispatched = request.beforeDispatch();
      sends.push({ ...request, ...pending, dispatched, sentAt: now });
      if (!dispatched) pending.resolve();
      return pending.promise;
    },
  });
  return {
    controller,
    sends,
    unknown,
    late,
    validTracks,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
      controller.checkDeadlines();
    },
    rebind: (sid: string, version: number) => fingerprints.set(sid, `${sid}:${version}`),
    invalidate: (identity: string) => invalidKeys.add(identity),
    desire: (key: SubscriptionKey, version: number, tracks: readonly string[]) =>
      controller.setDesired({ key, policyVersion: version, trackSids: tracks, generatedAtMs: now }),
    dispatched: () => sends.filter((s) => s.dispatched),
  };
}

/** Real RetirementBarrier whose remote calls are deferreds the test settles. */
export function barrierHarness(
  registry: MediaGenerationRegistry,
  generations: readonly Generation[],
) {
  let nowSeconds = Math.floor(EPOCH_MS / 1000);
  const persisted: { identity: string; state: Generation['state'] }[] = [];
  const removes: (Deferred & { identity: string; cutoff: bigint | undefined })[] = [];
  const absents: (Deferred<boolean> & { identity: string })[] = [];
  const unresolved: string[] = [];
  const confirmed: string[] = [];
  const stopped: string[] = [];
  const deps: RetirementBarrierDeps = {
    find: (input) =>
      generations.find(
        (g) =>
          g.request.matchId === input.matchId &&
          g.request.playerId === input.playerId &&
          g.request.mediaInstanceId === input.mediaInstanceId &&
          g.generation === input.receiverGeneration,
      ),
    capability: () => capability,
    nowEpochSeconds: () => nowSeconds,
    persist: async (g) => {
      persisted.push({ identity: g.identity, state: g.state });
    },
    stopPermissions: (g) => {
      stopped.push(g.identity);
    },
    remove: (g, cutoff) => {
      const pending = deferred();
      removes.push({ ...pending, identity: g.identity, cutoff });
      return pending.promise;
    },
    absent: (g) => {
      const pending = deferred<boolean>();
      absents.push({ ...pending, identity: g.identity });
      return pending.promise;
    },
    onUnresolved: (g) => {
      unresolved.push(g.identity);
    },
    onConfirmed: async (g) => {
      confirmed.push(g.identity);
    },
  };
  void registry;
  return {
    barrier: new RetirementBarrier(deps),
    persisted,
    removes,
    absents,
    unresolved,
    confirmed,
    stopped,
    advanceSeconds: (s: number) => {
      nowSeconds += s;
    },
  };
}

/** A remote participant as the LiveKit query would return it. */
export function participant(
  sid: string,
  identity: string,
  tracks: { sid: string; source: 'camera' | 'microphone' }[],
): RemoteParticipant {
  return {
    sid,
    identity,
    tracks: tracks.map((t) => ({
      sid: t.sid,
      source: t.source === 'camera' ? TrackSource.CAMERA : TrackSource.MICROPHONE,
      type: t.source === 'camera' ? TrackType.VIDEO : TrackType.AUDIO,
    })),
  };
}

/** Real TrackRegistry whose participant queries the test answers per owner identity. */
export function trackHarness() {
  let now = 0;
  const remote = new Map<string, RemoteParticipant | null>();
  const changed: string[] = [];
  const unauthorized: { identity: string; reason: string }[] = [];
  const getParticipant = vi.fn(async (owner: TrackOwner) => {
    if (!remote.has(owner.mediaIdentity)) throw new Error('QUERY_FAILED');
    return remote.get(owner.mediaIdentity) ?? null;
  });
  const registry = new TrackRegistry({
    now: () => now,
    getParticipant,
    onChanged: (owner) => changed.push(owner.mediaIdentity),
    onUnauthorized: (owner, reason) => unauthorized.push({ identity: owner.mediaIdentity, reason }),
  });
  return {
    registry,
    remote,
    changed,
    unauthorized,
    getParticipant,
    advance: (ms: number) => {
      now += ms;
    },
    /** Marks the owner dirty and lets the registry re-query, as a webhook event would. */
    async event(owner: TrackOwner) {
      registry.markEvent({ roomName: owner.mediaRoomName, identity: owner.mediaIdentity });
      now += 5000;
      await registry.reconcileDue();
    },
  };
}
