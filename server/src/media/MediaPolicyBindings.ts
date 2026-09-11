import { randomUUID } from 'node:crypto';
import { AudioProjection } from './AudioProjection.js';
import { AudibilityPolicy, type AudibilityFrame } from './AudibilityPolicy.js';
import { GatewayError, type LiveKitGateway } from './LiveKitGateway.js';
import { LiveKitWebhook, type WebhookVerifier } from './LiveKitWebhook.js';
import type { Generation, MediaGenerationRegistry } from './MediaGenerationRegistry.js';
import { SubscriptionController, type SubscriptionKey } from './SubscriptionController.js';
import { TrackRegistry, type TrackOwner } from './TrackRegistry.js';
import type {
  MediaConfiguration,
  MediaCoordinatorDeps,
  MediaFailureCode,
  TrustedMediaFrame,
} from './types.js';

export type MediaPolicyBindingsOptions = Readonly<{
  registry: MediaGenerationRegistry;
  gateway: LiveKitGateway;
  config: Pick<MediaConfiguration, 'apiKey' | 'apiSecret' | 'subscriptionMode'>;
  monotonicNow: () => number;
  enqueueBindings: MediaCoordinatorDeps['enqueueBindings'];
  enqueueAudioPolicy: MediaCoordinatorDeps['enqueueAudioPolicy'];
  emitMetric: MediaCoordinatorDeps['emitMetric'];
  emitEvent?: MediaCoordinatorDeps['emitEvent'];
  onFailure: (generation: Generation, code: MediaFailureCode) => void;
  /** Existing healthy generations remain permitted during ordinary admission draining. */
  isPermissionsAllowed: (generation: Generation) => boolean;
  webhookVerifier?: WebhookVerifier;
}>;

const scopeKey = (matchId: string, instanceId: string) => JSON.stringify([matchId, instanceId]);

/** Joins verified publications to receiver policies through the factory's one shared gateway. */
export class MediaPolicyBindings {
  private readonly registered = new Map<Generation, AbortController>();
  private readonly failed = new Set<Generation>();
  private readonly participantSids = new Map<Generation, string>();
  private readonly bindingVersions = new Map<
    Generation,
    { revision: number; fingerprint: string }
  >();
  private readonly frames = new Map<string, AudibilityFrame>();
  private readonly publishVersions = new Map<string, number>();
  private readonly audibility = new AudibilityPolicy();
  private readonly projection = new AudioProjection();
  private readonly tracks: TrackRegistry;
  private readonly subscriptions: SubscriptionController;
  private readonly webhook: LiveKitWebhook;
  private readonly shutdown = new AbortController();
  private closed = false;

  constructor(private readonly options: MediaPolicyBindingsOptions) {
    this.tracks = new TrackRegistry({
      now: options.monotonicNow,
      getParticipant: async (owner) => {
        const generation = this.findOwner(owner);
        if (!generation || !this.allowed(generation)) throw new Error('STALE_GENERATION');
        const signal = this.registered.get(generation)!.signal;
        try {
          const participant = await this.untilAborted(
            options.gateway.getParticipant(owner.mediaRoomName, owner.mediaIdentity, {
              requestId: randomUUID(),
              deadlineMs: options.monotonicNow() + 1000,
              signal,
              beforeDispatch: () => this.allowed(generation),
            }),
            signal,
          );
          if (!this.allowed(generation)) throw new Error('STALE_GENERATION');
          // TrackRegistry validates SID stability and sources before this is observable as valid.
          this.participantSids.set(generation, participant.sid);
          return participant;
        } catch (error) {
          if (error instanceof GatewayError && error.code === 'not_found') {
            this.participantSids.delete(generation);
            return null;
          }
          throw error;
        }
      },
      onChanged: (owner) => this.publish(owner.matchId, owner.mediaInstanceId),
      onUnauthorized: (owner, reason) => {
        const generation = this.findOwner(owner);
        if (generation) {
          this.diagnostic({
            generation: generation.generation,
            stage: 'track-validation',
            code: reason,
          });
          this.fail(generation);
        }
      },
    });
    this.subscriptions = new SubscriptionController({
      allowResponseTimeoutMs:
        options.config.subscriptionMode === 'publisher-permissions' ? 5000 : 1000,
      onDiagnostic: (input) => this.diagnostic(input),
      now: options.monotonicNow,
      validateKey: (key) => {
        const generation = this.findReceiver(key);
        return !!generation && this.allowed(generation);
      },
      validateTrack: (key, sid) => this.trackAllowed(key, sid),
      getTrackFingerprint: (key, sid) =>
        this.trackAllowed(key, sid) ? this.tracks.getTrackFingerprint(key, sid) : null,
      send: async (request) => {
        const generation = this.findReceiver(request.key);
        if (!generation || !this.allowed(generation)) throw new Error('STALE_GENERATION');
        await options.gateway.updateSubscriptions(
          request.key.mediaRoomName,
          request.key.receiverIdentity,
          [...request.trackSids],
          request.subscribe,
          {
            requestId: request.requestId,
            deadlineMs:
              options.monotonicNow() +
              (request.subscribe && options.config.subscriptionMode === 'publisher-permissions'
                ? 5000
                : 1000),
            priority: request.subscribe ? 'normal' : 'cleanup',
            signal: this.registered.get(generation)!.signal,
            beforeDispatch: request.beforeDispatch,
          },
        );
      },
      onUnknown: (key) => {
        const generation = this.findReceiver(key);
        if (generation) this.fail(generation);
      },
      emitMetric: options.emitMetric,
    });
    this.webhook = new LiveKitWebhook({
      ...options.config,
      registry: this.tracks,
      now: options.monotonicNow,
      verifier: options.webhookVerifier,
    });
  }

  /** Called only after the transition's final readiness checks have accepted this grant. */
  register(generation: Generation): void {
    if (this.closed || this.registered.has(generation) || this.failed.has(generation)) return;
    if (!this.options.registry.isCurrent(generation)) return;
    this.registered.set(generation, new AbortController());
    try {
      this.tracks.register(this.owner(generation));
    } catch {
      this.fail(generation);
      return;
    }
    this.publish(generation.request.matchId, generation.request.mediaInstanceId);
  }

  observeFrame(frame: TrustedMediaFrame): void {
    if (this.closed) return;
    const audible = this.audibility.observe(frame);
    if (!audible) return;
    this.frames.set(scopeKey(frame.matchId, frame.mediaInstanceId), audible);
    this.publish(frame.matchId, frame.mediaInstanceId);
  }

  retire(generation: Generation): void {
    const lifetime = this.registered.get(generation);
    if (!lifetime) return;
    this.registered.delete(generation);
    lifetime.abort();
    this.subscriptions.retire(this.receiver(generation));
    this.projection.forget(this.receiver(generation), generation.request.playerId);
    this.bindingVersions.delete(generation);
    this.participantSids.delete(generation);
    this.tracks.retire(this.owner(generation));
    const { matchId, mediaInstanceId } = generation.request;
    if (
      ![...this.registered.keys()].some(
        (g) => g.request.matchId === matchId && g.request.mediaInstanceId === mediaInstanceId,
      )
    ) {
      this.frames.delete(scopeKey(matchId, mediaInstanceId));
      this.audibility.forget(matchId, mediaInstanceId);
    }
  }

  async reconcile(): Promise<void> {
    if (this.closed) return;
    this.subscriptions.checkDeadlines();
    this.subscriptions.drainPending();
    await this.tracks.reconcileDue();
    if (this.closed) return;
    this.subscriptions.checkDeadlines();
    this.subscriptions.drainPending();
  }

  /** Marks only this accepted generation dirty; normal per-participant query pacing still applies. */
  requestReconciliation(generation: Generation): void {
    if (this.allowed(generation)) this.tracks.markDirty(this.owner(generation));
  }

  async handleWebhook(
    rawBody: string,
    authorization: string,
  ): Promise<{ status: 'accepted' | 'ignored' }> {
    if (this.closed) return { status: 'ignored' };
    try {
      const result = await this.untilAborted(
        this.webhook.handle(rawBody, authorization),
        this.shutdown.signal,
      );
      return this.closed ? { status: 'ignored' } : result;
    } catch (error) {
      if (this.closed) return { status: 'ignored' };
      throw error;
    }
  }

  inspect(generation: Generation) {
    if (!this.registered.has(generation) || this.closed) return null;
    const state = this.tracks.inspect(this.owner(generation));
    return state
      ? {
          ...state,
          participantSid: state.terminal ? null : (this.participantSids.get(generation) ?? null),
        }
      : null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.shutdown.abort();
    for (const generation of [...this.registered.keys()]) this.retire(generation);
    this.subscriptions.dispose();
    this.frames.clear();
    this.publishVersions.clear();
    this.failed.clear();
  }

  private publish(matchId: string, mediaInstanceId: string): void {
    if (this.closed) return;
    const scope = scopeKey(matchId, mediaInstanceId);
    const version = (this.publishVersions.get(scope) ?? 0) + 1;
    this.publishVersions.set(scope, version);
    const participants = this.tracks.listBindings(matchId, mediaInstanceId).filter((binding) => {
      const generation = this.options.registry.get(matchId, binding.playerId);
      return (
        !!generation &&
        this.allowed(generation) &&
        generation.generation === binding.publisherGeneration
      );
    });
    const audible = this.frames.get(scopeKey(matchId, mediaInstanceId));
    for (const generation of this.registered.keys()) {
      if (this.publishVersions.get(scope) !== version) return;
      if (
        !this.allowed(generation) ||
        generation.request.matchId !== matchId ||
        generation.request.mediaInstanceId !== mediaInstanceId
      )
        continue;
      const fingerprint = JSON.stringify(participants);
      let state = this.bindingVersions.get(generation);
      const changed = !state || state.fingerprint !== fingerprint;
      if (changed) {
        state = { revision: (state?.revision ?? 0) + 1, fingerprint };
        this.bindingVersions.set(generation, state);
      }
      if (!state) continue;
      const bindings = {
        matchId,
        mediaInstanceId,
        receiverGeneration: generation.generation,
        bindingRevision: state.revision,
        participants,
      };
      try {
        if (changed)
          this.options.enqueueBindings(generation.request.playerId, structuredClone(bindings));
        if (this.publishVersions.get(scope) !== version) return;
        if (!this.allowed(generation) || !audible) continue;
        const policy = this.projection.project(
          audible,
          generation.request.playerId,
          bindings,
          this.options.config.subscriptionMode === 'publisher-permissions',
        );
        if (!policy) continue;
        this.options.enqueueAudioPolicy(generation.request.playerId, structuredClone(policy));
        if (this.publishVersions.get(scope) !== version) return;
        if (!this.allowed(generation)) continue;
        const faces = participants
          .filter((entry) => entry.playerId !== generation.request.playerId)
          .flatMap((entry) => (entry.faceTrackSid ? [entry.faceTrackSid] : []));
        this.subscriptions.setDesired({
          key: this.receiver(generation),
          policyVersion: policy.policyRevision,
          trackSids: [...faces, ...policy.voices.map((voice) => voice.trackSid)],
          generatedAtMs: this.options.monotonicNow(),
        });
      } catch {
        this.fail(generation);
      }
    }
  }

  private allowed(generation: Generation): boolean {
    if (
      this.closed ||
      !this.registered.has(generation) ||
      this.failed.has(generation) ||
      !this.options.registry.isCurrent(generation)
    )
      return false;
    try {
      return this.options.isPermissionsAllowed(generation);
    } catch {
      return false;
    }
  }

  private trackAllowed(key: SubscriptionKey, sid: string): boolean {
    if (!this.tracks.validateTrack(key, sid)) return false;
    return this.tracks.listBindings(key.matchId, key.mediaInstanceId).some((binding) => {
      if (binding.faceTrackSid !== sid && binding.audioTrackSid !== sid) return false;
      const generation = this.options.registry.get(key.matchId, binding.playerId);
      return (
        !!generation &&
        this.allowed(generation) &&
        generation.generation === binding.publisherGeneration
      );
    });
  }

  private diagnostic(fields: {
    generation: number;
    stage: string;
    code: string;
    requestId?: string | null;
    durationMs?: number;
  }): void {
    try {
      this.options.emitEvent?.({
        event: 'media.policy.uncertain',
        level: 'warn',
        atMs: this.options.monotonicNow(),
        fields,
      });
    } catch {
      /* Diagnostics cannot affect permission control. */
    }
  }

  private fail(generation: Generation): void {
    if (this.closed || this.failed.has(generation) || !this.registered.has(generation)) return;
    this.failed.add(generation);
    this.retire(generation);
    try {
      this.options.onFailure(generation, 'POLICY_UNKNOWN');
    } catch {
      /* Local permission latch stays closed. */
    }
  }

  private findOwner(owner: TrackOwner): Generation | undefined {
    return [...this.registered.keys()].find(
      (generation) =>
        generation.request.matchId === owner.matchId &&
        generation.request.mediaInstanceId === owner.mediaInstanceId &&
        generation.request.playerId === owner.playerId &&
        generation.generation === owner.publisherGeneration &&
        generation.roomName === owner.mediaRoomName &&
        generation.identity === owner.mediaIdentity,
    );
  }

  private findReceiver(key: SubscriptionKey): Generation | undefined {
    return this.findOwner({
      ...key,
      mediaIdentity: key.receiverIdentity,
      publisherGeneration: key.receiverGeneration,
    });
  }

  private owner(generation: Generation): TrackOwner {
    return {
      matchId: generation.request.matchId,
      mediaInstanceId: generation.request.mediaInstanceId,
      mediaRoomName: generation.roomName,
      playerId: generation.request.playerId,
      mediaIdentity: generation.identity,
      publisherGeneration: generation.generation,
    };
  }

  private receiver(generation: Generation): SubscriptionKey {
    return {
      matchId: generation.request.matchId,
      mediaInstanceId: generation.request.mediaInstanceId,
      mediaRoomName: generation.roomName,
      playerId: generation.request.playerId,
      receiverIdentity: generation.identity,
      receiverGeneration: generation.generation,
    };
  }

  private untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new Error('POLICY_CLOSED'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      void operation
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  }
}
