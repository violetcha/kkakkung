import { randomUUID } from 'node:crypto';
import { TrackSource, TrackType } from 'livekit-server-sdk';
import { AudioProjection } from './AudioProjection.js';
import { AudibilityPolicy, type AudibilityFrame } from './AudibilityPolicy.js';
import type { CapabilityReport } from './CloudCapabilityProbe.js';
import type { ForwardCompletion } from '../operations/ForwardIntent.js';
import { ForwardedMediaEdge, type ForwardSource } from './ForwardedMediaEdge.js';
import { GatewayError } from './LiveKitGateway.js';
import { LiveKitWebhook } from './LiveKitWebhook.js';
import type { Generation } from './MediaGenerationRegistry.js';
import type { LifecycleInspection } from './MediaLifecycle.js';
import type { MediaPolicyBindingsOptions } from './MediaPolicyBindings.js';
import { TrackRegistry, type TrackOwner } from './TrackRegistry.js';
import type { MediaBinding, TrustedMediaFrame } from './types.js';

type Registration = {
  abort: AbortController;
  face: TrackOwner;
  voice: TrackOwner;
  faceSid: string | null;
  voiceSid: string | null;
};
type Edge = {
  publisher: Generation;
  receiver: Generation;
  kind: 'face' | 'audio';
  edge: ForwardedMediaEdge;
};
const scope = (matchId: string, instance: string) => JSON.stringify([matchId, instance]);

/** Product source inspection, authoritative audibility and destination-verified bindings.
 * Publisher allowlists and client subscription requests play no part in this authority.
 */
export class SplitMediaPolicyBindings {
  private readonly registered = new Map<Generation, Registration>();
  private readonly failed = new Set<Generation>();
  private readonly retired = new WeakSet<Generation>();
  private readonly edges = new Map<string, Edge>();
  private readonly frames = new Map<string, AudibilityFrame>();
  private readonly versions = new Map<Generation, { revision: number; fingerprint: string }>();
  private readonly publishing = new Set<string>();
  private readonly refreshAgain = new Set<string>();
  private readonly audibility = new AudibilityPolicy();
  private readonly projection = new AudioProjection();
  private readonly tracks: TrackRegistry;
  private readonly webhook: LiveKitWebhook;
  private closed = false;

  constructor(
    private readonly options: MediaPolicyBindingsOptions & {
      capability: () => CapabilityReport | null;
      epochNowSeconds: () => number;
      prepareForward: (
        publisher: Generation,
        receiver: Generation,
        kind: 'face' | 'audio',
      ) => Promise<ForwardCompletion>;
    },
  ) {
    this.tracks = new TrackRegistry({
      now: options.monotonicNow,
      getParticipant: async (owner) => {
        const found = this.findOwner(owner);
        if (!found || !this.allowed(found.generation)) throw new Error('STALE_GENERATION');
        const { generation, registration, face } = found;
        try {
          const participant = await options.gateway.getParticipant(
            owner.mediaRoomName,
            owner.mediaIdentity,
            {
              requestId: randomUUID(),
              deadlineMs: options.monotonicNow() + 1000,
              signal: registration.abort.signal,
              beforeDispatch: () => this.allowed(generation),
            },
          );
          if (!this.allowed(generation)) throw new Error('STALE_GENERATION');
          if (
            participant.tracks.some(
              (track) =>
                track.source !== (face ? TrackSource.CAMERA : TrackSource.MICROPHONE) ||
                track.type !== (face ? TrackType.VIDEO : TrackType.AUDIO),
            )
          ) {
            this.fail(generation);
            throw new Error('UNAUTHORIZED_SPLIT_SOURCE');
          }
          if (face) registration.faceSid = participant.sid;
          else registration.voiceSid = participant.sid;
          return participant;
        } catch (error) {
          if (error instanceof GatewayError && error.code === 'not_found') {
            if (face) registration.faceSid = null;
            else registration.voiceSid = null;
            return null;
          }
          throw error;
        }
      },
      onChanged: (owner) => this.refresh(owner.matchId, owner.mediaInstanceId),
      onUnauthorized: (owner) => {
        const found = this.findOwner(owner);
        if (found) this.fail(found.generation);
      },
    });
    this.webhook = new LiveKitWebhook({
      ...options.config,
      now: options.monotonicNow,
      verifier: options.webhookVerifier,
      onEvent: (name, outcome) => {
        try {
          options.emitEvent?.({
            event: 'media.webhook',
            level: 'info',
            atMs: options.monotonicNow(),
            fields: { name, code: outcome },
          });
        } catch {
          /* Diagnostics cannot affect webhook handling. */
        }
      },
      registry: {
        markEvent: (event) => {
          let matched = this.tracks.markEvent(event);
          for (const item of this.edges.values()) {
            const identity =
              item.kind === 'face'
                ? item.publisher.splitOwnership!.faceIdentity
                : item.publisher.identity;
            if (
              item.receiver.roomName === event.roomName &&
              (!event.identity || event.identity === identity)
            ) {
              item.edge.markDirty();
              matched = true;
            }
          }
          return matched;
        },
        reconcileDue: () => this.reconcile(),
      },
    });
  }

  register(generation: Generation): void {
    if (
      this.closed ||
      this.retired.has(generation) ||
      this.registered.has(generation) ||
      !this.options.registry.isCurrent(generation)
    )
      return;
    if (!generation.splitOwnership) {
      this.options.onFailure(generation, 'POLICY_UNKNOWN');
      return;
    }
    const owner = (face: boolean): TrackOwner => ({
      matchId: generation.request.matchId,
      mediaInstanceId: generation.request.mediaInstanceId,
      playerId: generation.request.playerId,
      publisherGeneration: generation.generation,
      mediaRoomName: face ? generation.splitOwnership!.faceRoomName : generation.roomName,
      mediaIdentity: face ? generation.splitOwnership!.faceIdentity : generation.identity,
    });
    const registration = {
      abort: new AbortController(),
      face: owner(true),
      voice: owner(false),
      faceSid: null,
      voiceSid: null,
    };
    this.registered.set(generation, registration);
    try {
      this.tracks.register(registration.face);
      this.tracks.register(registration.voice);
    } catch {
      this.fail(generation);
      return;
    }
    this.refresh(generation.request.matchId, generation.request.mediaInstanceId);
  }

  observeFrame(frame: TrustedMediaFrame): void {
    if (this.closed) return;
    const audible = this.audibility.observe(frame);
    if (!audible) return;
    this.frames.set(scope(frame.matchId, frame.mediaInstanceId), audible);
    this.refresh(frame.matchId, frame.mediaInstanceId);
  }

  retire(generation: Generation): void {
    this.retired.add(generation);
    const registration = this.registered.get(generation);
    this.registered.delete(generation);
    registration?.abort.abort();
    for (const item of this.edges.values())
      if (item.publisher === generation || item.receiver === generation) item.edge.retire();
    if (registration) {
      this.tracks.forget(registration.face);
      this.tracks.forget(registration.voice);
    }
    this.versions.delete(generation);
    this.projection.forget(
      { ...generation.request, receiverGeneration: generation.generation },
      generation.request.playerId,
    );
    this.refresh(generation.request.matchId, generation.request.mediaInstanceId);
  }

  async quiesce(generation: Generation): Promise<void> {
    this.retire(generation);
    const owned = [...this.edges].filter(
      ([, item]) => item.publisher === generation || item.receiver === generation,
    );
    const results = await Promise.allSettled(owned.map(([, item]) => item.edge.quiesce()));
    let failed = false;
    results.forEach((result, index) => {
      if (result.status === 'rejected') failed = true;
      else this.edges.delete(owned[index]![0]);
    });
    if (failed) throw new Error('FORWARD_EFFECT_UNCONFIRMED');
  }

  async reconcile(): Promise<void> {
    if (this.closed) return;
    for (const item of this.edges.values()) item.edge.checkDeadlines();
    await this.tracks.reconcileDue();
    if (this.closed) return;
    for (const frame of this.frames.values()) this.refresh(frame.matchId, frame.mediaInstanceId);
    await Promise.all([...this.edges.values()].map((item) => item.edge.reconcile()));
  }

  requestReconciliation(generation: Generation): void {
    const registration = this.registered.get(generation);
    if (registration && this.allowed(generation)) {
      this.tracks.markDirty(registration.face);
      this.tracks.markDirty(registration.voice);
    }
  }
  async handleWebhook(rawBody: string, authorization: string) {
    if (this.closed) return { status: 'ignored' as const };
    try {
      const result = await this.webhook.handle(rawBody, authorization);
      return this.closed ? { status: 'ignored' as const } : result;
    } catch (error) {
      if (this.closed) return { status: 'ignored' as const };
      throw error;
    }
  }
  inspect(generation: Generation): LifecycleInspection | null {
    const registration = this.registered.get(generation);
    if (this.closed || !registration) return null;
    const face = this.tracks.inspect(registration.face);
    const voice = this.tracks.inspect(registration.voice);
    if (!face || !voice) return null;
    const connected = !!registration.faceSid && !!registration.voiceSid;
    return {
      participantSid: connected ? registration.voiceSid : null,
      faceParticipantSid: connected ? registration.faceSid : null,
      dirty: face.dirty || voice.dirty,
      terminal: face.terminal || voice.terminal,
      lastVerifiedAt:
        connected && face.lastVerifiedAt !== null && voice.lastVerifiedAt !== null
          ? Math.min(face.lastVerifiedAt, voice.lastVerifiedAt)
          : null,
      bindings: [...face.bindings, ...voice.bindings],
    };
  }

  forgetMatch(matchId: string): void {
    for (const generation of this.registered.keys())
      if (generation.request.matchId === matchId) this.retire(generation);
    for (const [key, frame] of this.frames)
      if (frame.matchId === matchId) {
        this.frames.delete(key);
        this.audibility.forget(matchId, frame.mediaInstanceId);
      }
    for (const generation of this.failed)
      if (generation.request.matchId === matchId) this.failed.delete(generation);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const generation of this.registered.keys()) this.retire(generation);
    this.frames.clear();
    this.versions.clear();
    this.failed.clear();
  }
  get retained() {
    return {
      registered: this.registered.size,
      failed: this.failed.size,
      frames: this.frames.size,
      versions: this.versions.size,
      tracks: this.tracks.retained,
      subscriptions: this.edges.size,
    };
  }

  private refresh(matchId: string, mediaInstanceId: string): void {
    if (this.closed) return;
    const key = scope(matchId, mediaInstanceId);
    if (this.publishing.has(key)) {
      this.refreshAgain.add(key);
      return;
    }
    this.publishing.add(key);
    try {
      do {
        this.refreshAgain.delete(key);
        const frame = this.frames.get(key);
        for (const generation of this.registered.keys())
          if (
            generation.request.matchId === matchId &&
            generation.request.mediaInstanceId === mediaInstanceId &&
            !this.allowed(generation)
          )
            this.fail(generation);
        const generations = [...this.registered.keys()].filter(
          (g) =>
            g.request.matchId === matchId &&
            g.request.mediaInstanceId === mediaInstanceId &&
            this.allowed(g),
        );
        for (const receiver of generations) {
          for (const publisher of generations) {
            if (publisher === receiver) continue;
            for (const kind of ['face', 'audio'] as const) {
              const edgeKey = JSON.stringify([
                key,
                publisher.request.playerId,
                publisher.generation,
                receiver.request.playerId,
                receiver.generation,
                kind,
              ]);
              let item = this.edges.get(edgeKey);
              const permitted =
                !!frame &&
                (kind === 'face' ||
                  frame.receivers
                    .find((entry) => entry.playerId === receiver.request.playerId)
                    ?.voices.some((voice) => voice.playerId === publisher.request.playerId));
              const source =
                permitted && this.connected(receiver) ? this.source(publisher, kind) : null;
              if (!item && source) {
                item = {
                  publisher,
                  receiver,
                  kind,
                  edge: new ForwardedMediaEdge({
                    publisher,
                    receiver,
                    kind,
                    gateway: this.options.gateway,
                    prepareForward: () => this.options.prepareForward(publisher, receiver, kind),
                    capability: this.options.capability,
                    epochNowSeconds: this.options.epochNowSeconds,
                    monotonicNow: this.options.monotonicNow,
                    readSource: () => this.source(publisher, kind),
                    isAllowed: () =>
                      this.allowed(publisher) && this.allowed(receiver) && this.connected(receiver),
                    onChanged: () => this.refresh(matchId, mediaInstanceId),
                    onFailure: () => {
                      this.fail(publisher);
                      this.fail(receiver);
                    },
                  }),
                };
                this.edges.set(edgeKey, item);
              }
              item?.edge.setDesired(source);
            }
          }
        }
        for (const item of this.edges.values())
          if (
            item.publisher.request.matchId === matchId &&
            item.publisher.request.mediaInstanceId === mediaInstanceId &&
            (!this.allowed(item.publisher) || !this.allowed(item.receiver))
          )
            item.edge.retire();
        for (const receiver of generations) {
          if (!this.allowed(receiver)) continue;
          const participants = generations.flatMap((publisher) => {
            const binding = this.binding(publisher, receiver);
            return binding ? [binding] : [];
          });
          const fingerprint = JSON.stringify(participants);
          let version = this.versions.get(receiver);
          const changed = version?.fingerprint !== fingerprint;
          if (changed) {
            version = { revision: (version?.revision ?? 0) + 1, fingerprint };
            this.versions.set(receiver, version);
          }
          const bindings = {
            matchId,
            mediaInstanceId,
            receiverGeneration: receiver.generation,
            bindingRevision: version!.revision,
            participants,
          };
          try {
            if (changed)
              this.options.enqueueBindings(receiver.request.playerId, structuredClone(bindings));
            if (!this.allowed(receiver) || !frame) continue;
            const policy = this.projection.project(frame, receiver.request.playerId, bindings);
            if (policy)
              this.options.enqueueAudioPolicy(receiver.request.playerId, structuredClone(policy));
          } catch {
            this.fail(receiver);
          }
        }
      } while (!this.closed && this.refreshAgain.has(key));
    } finally {
      this.publishing.delete(key);
    }
  }

  private binding(publisher: Generation, receiver: Generation): MediaBinding | null {
    if (!this.allowed(publisher) || !this.allowed(receiver)) return null;
    const registration = this.registered.get(publisher)!;
    if (!registration.voiceSid || !registration.faceSid) return null;
    if (publisher === receiver) {
      const face = this.source(publisher, 'face');
      const audio = this.source(publisher, 'audio');
      return {
        playerId: publisher.request.playerId,
        publisherGeneration: publisher.generation,
        mediaIdentity: publisher.identity,
        participantSid: registration.voiceSid,
        ...(face
          ? {
              faceTrackSid: face.trackSid,
              facePublisher: {
                mediaIdentity: publisher.splitOwnership!.faceIdentity,
                participantSid: face.participantSid,
              },
            }
          : {}),
        ...(audio ? { audioTrackSid: audio.trackSid } : {}),
      };
    }
    const related = [...this.edges.values()].filter(
      (item) => item.publisher === publisher && item.receiver === receiver,
    );
    const face = related.find((item) => item.kind === 'face')?.edge.binding;
    const audio = related.find((item) => item.kind === 'audio')?.edge.binding;
    if (!face && !audio) return null;
    return {
      playerId: publisher.request.playerId,
      publisherGeneration: publisher.generation,
      mediaIdentity: publisher.identity,
      participantSid: audio?.participantSid ?? registration.voiceSid,
      ...(face
        ? {
            faceTrackSid: face.trackSid,
            facePublisher: {
              mediaIdentity: face.mediaIdentity,
              participantSid: face.participantSid,
            },
          }
        : {}),
      ...(audio ? { audioTrackSid: audio.trackSid } : {}),
    };
  }
  private source(generation: Generation, kind: 'face' | 'audio'): ForwardSource | null {
    const registration = this.registered.get(generation);
    if (!registration || !this.allowed(generation) || !this.connected(generation)) return null;
    const state = this.tracks.inspect(kind === 'face' ? registration.face : registration.voice);
    if (!state || state.terminal) return null;
    const binding = state.bindings.find(
      (entry) =>
        entry.source === (kind === 'face' ? 'camera' : 'microphone') &&
        entry.participantSid === (kind === 'face' ? registration.faceSid : registration.voiceSid),
    );
    return binding ? { participantSid: binding.participantSid, trackSid: binding.trackSid } : null;
  }
  private connected(generation: Generation): boolean {
    const state = this.inspect(generation);
    return !!state?.participantSid && !state.terminal;
  }
  private allowed(generation: Generation): boolean {
    try {
      return (
        !this.closed &&
        this.registered.has(generation) &&
        !this.failed.has(generation) &&
        this.options.registry.isCurrent(generation) &&
        this.options.isPermissionsAllowed(generation)
      );
    } catch {
      return false;
    }
  }
  private findOwner(owner: TrackOwner) {
    for (const [generation, registration] of this.registered) {
      for (const face of [true, false]) {
        const candidate = face ? registration.face : registration.voice;
        if (
          candidate.matchId === owner.matchId &&
          candidate.mediaInstanceId === owner.mediaInstanceId &&
          candidate.playerId === owner.playerId &&
          candidate.publisherGeneration === owner.publisherGeneration &&
          candidate.mediaRoomName === owner.mediaRoomName &&
          candidate.mediaIdentity === owner.mediaIdentity
        )
          return { generation, registration, face };
      }
    }
    return null;
  }
  private fail(generation: Generation): void {
    if (this.closed || this.failed.has(generation)) return;
    this.failed.add(generation);
    this.retire(generation);
    try {
      this.options.onFailure(generation, 'POLICY_UNKNOWN');
    } catch {
      /* Fence remains closed. */
    }
  }
}
