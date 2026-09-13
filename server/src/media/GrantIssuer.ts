import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { parseCapabilityReport, type CapabilityReport } from './CloudCapabilityProbe.js';
import { MediaGenerationRegistry, type Generation } from './MediaGenerationRegistry.js';
import { LIVEKIT_SDK_VERSION } from './LiveKitGateway.js';
import type {
  MediaConfiguration,
  MediaFailureCode,
  PreparationResult,
  PrepareGenerationRequest,
} from './types.js';

export type GrantIssuerDeps = {
  config: MediaConfiguration;
  registry: MediaGenerationRegistry;
  nowEpochMs: () => number;
  canIssue: (existingGeneration?: Generation, requested?: PrepareGenerationRequest) => boolean;
  capability: () => CapabilityReport | null;
  reserve: (generation: Generation) => Promise<boolean>;
  persist: (generation: Generation) => Promise<void>;
  retire: (generation: Generation) => void;
  lock: (reason: string) => void;
  onPrepared: (result: PreparationResult) => void;
  sign?: (generation: Generation, publication?: 'face' | 'receiver') => Promise<string>;
};

function fingerprint(input: PrepareGenerationRequest): string {
  return JSON.stringify([
    input.matchId,
    input.playerId,
    input.mediaInstanceId,
    input.purpose,
    input.expectedPreviousGeneration,
  ]);
}

function scope(input: PrepareGenerationRequest) {
  return {
    requestId: input.requestId,
    matchId: input.matchId,
    playerId: input.playerId,
    mediaInstanceId: input.mediaInstanceId,
  };
}

type CachedRequest = {
  fingerprint: string;
  promise: Promise<PreparationResult>;
  result?: PreparationResult;
  settledAtEpochMs?: number;
};

export class GrantIssuer {
  private readonly requests = new Map<string, CachedRequest>();
  private readonly scopes = new Map<string, Promise<unknown>>();
  constructor(
    private readonly deps: GrantIssuerDeps,
    private readonly cache = { maxRequests: 4096, retentionMs: 600_000 },
  ) {
    if (
      !Number.isSafeInteger(cache.maxRequests) ||
      cache.maxRequests <= 0 ||
      !Number.isSafeInteger(cache.retentionMs) ||
      cache.retentionMs < 300_000
    )
      throw new Error('INVALID_GRANT_CACHE_LIMITS');
  }

  /** Never discard pending issuance or rely on this cache to authorize a generation. */
  prune(): void {
    const now = this.deps.nowEpochMs();
    for (const [id, request] of this.requests)
      if (
        request.settledAtEpochMs !== undefined &&
        now - request.settledAtEpochMs >= this.cache.retentionMs
      )
        this.requests.delete(id);
  }

  get retained() {
    return { requests: this.requests.size, pendingScopes: this.scopes.size };
  }

  prepare(requested: PrepareGenerationRequest): Promise<PreparationResult> {
    this.prune();
    const input = { ...requested };
    const reject = (code: MediaFailureCode): PreparationResult => ({
      ...scope(input),
      status: 'rejected',
      receiverGeneration: null,
      grant: null,
      code,
    });
    if (!input.requestId || !input.matchId || !input.playerId || !input.mediaInstanceId)
      return Promise.resolve(reject('WRONG_SCOPE'));
    const existing = this.requests.get(input.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint(input))
        return Promise.resolve(reject('WRONG_SCOPE'));
      const canRecheckGate =
        existing.result?.status === 'rejected' &&
        existing.result.receiverGeneration === null &&
        existing.result.code === 'NOT_READY';
      if (!canRecheckGate)
        return existing.promise.then((result) => {
          const current = this.deps.registry.get(input.matchId, input.playerId);
          if (
            result.status === 'ready' &&
            (!current ||
              current.generation !== result.receiverGeneration ||
              current.identity !== result.grant.mediaIdentity ||
              !this.deps.registry.isCurrent(current) ||
              !this.deps.canIssue(current) ||
              !this.capabilitySupported() ||
              (current.splitOwnership &&
                (result.grant.subscriptionMode !== 'server-forwarding' ||
                  result.grant.facePublication?.roomName !== current.splitOwnership.faceRoomName ||
                  result.grant.facePublication?.mediaIdentity !==
                    current.splitOwnership.faceIdentity)) ||
              result.grant.expiresAt <= this.deps.nowEpochMs() / 1000)
          )
            return reject('STALE_GENERATION');
          return result;
        });
    }
    if (!existing && this.requests.size >= this.cache.maxRequests)
      return Promise.resolve(reject('NOT_READY'));
    const key = JSON.stringify([input.matchId, input.playerId]);
    const previous = this.scopes.get(key) ?? Promise.resolve();
    const promise = previous.then(() => this.issue({ ...input }));
    const tail = promise.then(
      () => undefined,
      () => undefined,
    );
    this.scopes.set(key, tail);
    void tail.then(() => {
      // A later request may already have chained onto this scope.
      if (this.scopes.get(key) === tail) this.scopes.delete(key);
    });
    const request: CachedRequest = { fingerprint: fingerprint(input), promise };
    this.requests.set(input.requestId, request);
    void promise.then(
      (result) => {
        request.result = result;
        request.settledAtEpochMs = this.deps.nowEpochMs();
      },
      () => {
        request.settledAtEpochMs = this.deps.nowEpochMs();
      },
    );
    return promise;
  }

  private async issue(input: PrepareGenerationRequest): Promise<PreparationResult> {
    const result = (
      code: MediaFailureCode,
      generation: number | null = null,
    ): PreparationResult => ({
      ...scope(input),
      status: 'rejected',
      receiverGeneration: generation,
      grant: null,
      code,
    });
    const d = this.deps;
    if (!d.canIssue(undefined, input) || !this.capabilitySupported()) return result('NOT_READY');
    if (!d.registry.eligible(input)) return result('WRONG_SCOPE');
    const old = d.registry.get(input.matchId, input.playerId);
    if ((old?.generation ?? null) !== input.expectedPreviousGeneration)
      return result('STALE_GENERATION');
    if (old && old.state !== 'REVOKED') return result('RETIREMENT_UNCONFIRMED');
    if (
      d.registry
        .all()
        .some(
          (g) =>
            g.request.playerId === input.playerId &&
            g.request.matchId !== input.matchId &&
            g.state !== 'REVOKED',
        )
    )
      return result('RETIREMENT_UNCONFIRMED');
    let generation: Generation;
    try {
      generation = d.registry.allocate(input, d.nowEpochMs());
    } catch {
      return result('STALE_GENERATION');
    }
    const split = d.config.subscriptionMode === 'server-forwarding';
    if (split !== (generation.splitOwnership !== undefined)) {
      d.registry.abandonUnissued(generation);
      return result('NOT_READY', generation.generation);
    }
    try {
      if (!(await d.reserve(generation))) {
        // No JWT exists, but leave the allocated generation terminal so this attempt cannot reopen.
        d.registry.abandonUnissued(generation);
        return result('BUDGET_EXHAUSTED', generation.generation);
      }
      await d.persist(generation);
      if (
        !d.canIssue(generation) ||
        !this.capabilitySupported() ||
        !d.registry.isCurrent(generation)
      ) {
        d.retire(generation);
        return result('NOT_READY', generation.generation);
      }
      const token = await (d.sign
        ? split
          ? d.sign(generation, 'receiver')
          : d.sign(generation)
        : this.sign(generation, split ? 'receiver' : undefined));
      let faceToken: string | undefined;
      if (split) {
        if (
          !d.canIssue(generation) ||
          !this.capabilitySupported() ||
          !d.registry.isCurrent(generation) ||
          d.nowEpochMs() / 1000 >= Math.floor(generation.expiresAtEpochMs / 1000)
        ) {
          d.retire(generation);
          return result('STALE_GENERATION', generation.generation);
        }
        faceToken = await (d.sign ? d.sign(generation, 'face') : this.sign(generation, 'face'));
        if (!faceToken || faceToken === token) throw new Error('INVALID_SPLIT_TOKEN_PAIR');
      }
      if (
        !d.canIssue(generation) ||
        !this.capabilitySupported() ||
        !d.registry.isCurrent(generation) ||
        d.nowEpochMs() / 1000 >= Math.floor(generation.expiresAtEpochMs / 1000)
      ) {
        d.retire(generation);
        return result('STALE_GENERATION', generation.generation);
      }
      const ready: PreparationResult = {
        requestId: input.requestId,
        matchId: input.matchId,
        playerId: input.playerId,
        mediaInstanceId: input.mediaInstanceId,
        status: 'ready',
        receiverGeneration: generation.generation,
        code: null,
        grant: {
          ...(d.config.subscriptionMode === 'publisher-permissions'
            ? { subscriptionMode: 'publisher-permissions' as const }
            : {}),
          ...(split
            ? {
                subscriptionMode: 'server-forwarding' as const,
                facePublication: {
                  url: d.config.wsUrl,
                  token: faceToken!,
                  roomName: generation.splitOwnership!.faceRoomName,
                  mediaIdentity: generation.splitOwnership!.faceIdentity,
                },
              }
            : {}),
          matchId: input.matchId,
          mediaInstanceId: input.mediaInstanceId,
          receiverGeneration: generation.generation,
          url: d.config.wsUrl,
          token,
          roomName: generation.roomName,
          mediaIdentity: generation.identity,
          expiresAt: Math.floor(generation.expiresAtEpochMs / 1000),
        },
      };
      d.onPrepared(ready);
      return ready;
    } catch {
      generation.terminal = true;
      generation.state = 'UNRESOLVED';
      try {
        d.lock('ISSUANCE_UNRESOLVED');
      } catch {
        /* Keep the local terminal latch. */
      }
      try {
        d.retire(generation);
      } catch {
        /* Durable unresolved intent remains for recovery. */
      }
      return {
        ...scope(input),
        status: 'unknown',
        receiverGeneration: generation.generation,
        grant: null,
        code: 'REMOTE_UNAVAILABLE',
      };
    }
  }

  private capabilitySupported(): boolean {
    if (this.deps.config.subscriptionMode !== 'server-forwarding')
      return this.deps.capability()?.status === 'SUPPORTED';
    try {
      const report = parseCapabilityReport(this.deps.capability());
      return (
        report.status === 'SUPPORTED' &&
        report.subscriptionMode === 'server-forwarding' &&
        report.cloudProjectAlias === this.deps.config.projectAlias &&
        report.namespace === this.deps.config.namespace &&
        report.sdkVersion === LIVEKIT_SDK_VERSION &&
        report.testedAtEpochMs <= this.deps.nowEpochMs()
      );
    } catch {
      return false;
    }
  }

  private async sign(generation: Generation, publication?: 'face' | 'receiver'): Promise<string> {
    const report = this.deps.capability();
    if (publication) {
      if (
        !this.capabilitySupported() ||
        !generation.splitOwnership ||
        this.deps.config.subscriptionMode !== 'server-forwarding'
      )
        throw new Error('CAPABILITY_UNVERIFIED');
      const face = publication === 'face';
      const token = new AccessToken(this.deps.config.apiKey, this.deps.config.apiSecret, {
        identity: face ? generation.splitOwnership.faceIdentity : generation.identity,
        ttl: 300,
      });
      token.ttl = Math.floor(generation.expiresAtEpochMs / 1000);
      token.addGrant({
        roomJoin: true,
        room: face ? generation.splitOwnership.faceRoomName : generation.roomName,
        canPublishData: false,
        canSubscribe: !face,
        canPublishSources: [face ? TrackSource.CAMERA : TrackSource.MICROPHONE],
        roomAdmin: false,
        roomRecord: false,
        roomCreate: false,
        roomList: false,
      });
      return token.toJwt();
    }
    if (
      report?.status !== 'SUPPORTED' ||
      !report.grantProfile ||
      (report.subscriptionMode ?? 'server-controlled') !==
        (this.deps.config.subscriptionMode ?? 'server-controlled') ||
      report.grantProfile.canSubscribe !==
        (this.deps.config.subscriptionMode === 'publisher-permissions')
    )
      throw new Error('CAPABILITY_UNVERIFIED');
    const token = new AccessToken(this.deps.config.apiKey, this.deps.config.apiSecret, {
      identity: generation.identity,
      ttl: 300,
    });
    // SDK 2.18 toJwt forwards this public property to jose.setExpirationTime.
    // Numeric absolute expiry keeps disk latency inside the persisted five-minute window.
    token.ttl = Math.floor(generation.expiresAtEpochMs / 1000);
    token.addGrant({
      roomJoin: true,
      room: generation.roomName,
      canPublishData: false,
      canSubscribe: this.deps.config.subscriptionMode === 'publisher-permissions',
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
      roomAdmin: false,
      roomRecord: false,
      roomCreate: false,
      roomList: false,
    });
    return token.toJwt();
  }
}
