import { randomUUID } from 'node:crypto';
import { TrackSource, TrackType } from 'livekit-server-sdk';
import { ApiBudgetError } from '../operations/ApiBudget.js';
import type { CapabilityReport } from './CloudCapabilityProbe.js';
import { GatewayError, type LiveKitGateway } from './LiveKitGateway.js';
import type { Generation } from './MediaGenerationRegistry.js';
import { PolicyUncertainty, type PolicyTimer } from './PolicyUncertainty.js';
import { confirmRemoteRevocation } from './RemoteRevocation.js';

export type ForwardSource = Readonly<{ participantSid: string; trackSid: string }>;
export type ForwardBinding = Readonly<{
  mediaIdentity: string;
  participantSid: string;
  trackSid: string;
}>;
export type ForwardedMediaEdgeOptions = Readonly<{
  publisher: Generation;
  receiver: Generation;
  kind: 'face' | 'audio';
  gateway: LiveKitGateway;
  capability: () => CapabilityReport | null;
  monotonicNow: () => number;
  epochNowSeconds: () => number;
  readSource: () => ForwardSource | null;
  isAllowed: () => boolean;
  onChanged: () => void;
  onFailure: (reason: string) => void;
  timer?: PolicyTimer;
}>;
const fingerprint = (value: ForwardSource | null) =>
  value ? JSON.stringify([value.participantSid, value.trackSid]) : null;

/** One serialized, server-owned origin/destination relationship. In-flight HTTP is never aborted
 * logically: its eventual outcome must be drained before retirement can confirm remote absence.
 */
export class ForwardedMediaEdge {
  private readonly sourceRoom: string;
  private readonly identity: string;
  private readonly destination: string;
  private readonly ownership: string;
  private readonly lifetime = new AbortController();
  private readonly uncertainty: PolicyUncertainty;
  private desired: ForwardSource | null = null;
  private confirmed: { source: string; binding: ForwardBinding } | null = null;
  private pending: Promise<void> | null = null;
  private revision = 0;
  private mightExist = false;
  private retired = false;
  private failed = false;
  private unknownForward = false;
  private dirtyRevision = 0;
  private verifiedRevision = -1;
  private lastVerifiedAt = -Infinity;

  constructor(private readonly options: ForwardedMediaEdgeOptions) {
    const { publisher, receiver, kind } = options;
    if (
      !publisher.splitOwnership ||
      !receiver.splitOwnership ||
      publisher === receiver ||
      publisher.request.playerId === receiver.request.playerId ||
      publisher.request.matchId !== receiver.request.matchId ||
      publisher.request.mediaInstanceId !== receiver.request.mediaInstanceId ||
      publisher.serverEpoch !== receiver.serverEpoch ||
      publisher.splitOwnership.faceRoomName !== receiver.splitOwnership.faceRoomName ||
      !publisher.splitOwnership.receiverRoomNames.includes(receiver.roomName)
    )
      throw new Error('INVALID_FORWARD_OWNERSHIP');
    this.sourceRoom = kind === 'face' ? publisher.splitOwnership.faceRoomName : publisher.roomName;
    this.identity = kind === 'face' ? publisher.splitOwnership.faceIdentity : publisher.identity;
    this.destination = receiver.roomName;
    this.ownership = this.ownershipKey();
    this.uncertainty = new PolicyUncertainty(
      options.monotonicNow,
      (reason) => this.fail(reason),
      options.timer,
    );
  }

  setDesired(source: ForwardSource | null): void {
    if (this.retired || this.failed) return;
    if (source && (!source.participantSid || !source.trackSid || !this.allowed())) {
      this.fail('INVALID_FORWARD_SOURCE');
      return;
    }
    if (fingerprint(source) === fingerprint(this.desired)) return;
    this.desired = source ? { ...source } : null;
    this.revision++;
    if (this.mightExist) this.uncertainty.requireBlock(this.options.monotonicNow());
    if (this.confirmed?.source !== fingerprint(source)) this.clearBinding();
    this.start();
  }

  get binding(): ForwardBinding | null {
    return this.confirmed && !this.retired && !this.failed && this.allowed()
      ? { ...this.confirmed.binding }
      : null;
  }

  retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.desired = null;
    this.revision++;
    this.lifetime.abort(); // ApiBudget cancels queued requests only; sent promises remain pending.
    this.uncertainty.dispose();
    this.clearBinding();
    this.start();
  }

  /** Call after fencing new permissions. Remote original revocation must still run even if this
   * throws: a transport-unknown forward is retained unresolved, never promoted from one absence.
   */
  async quiesce(): Promise<void> {
    if (!this.retired) throw new Error('FORWARD_EDGE_NOT_RETIRED');
    while (this.pending) await this.pending;
    if (this.mightExist) {
      this.start();
      while (this.pending) await this.pending;
    }
    if (this.unknownForward || this.mightExist) throw new Error('FORWARD_EFFECT_UNCONFIRMED');
  }

  checkDeadlines(): void {
    this.uncertainty.check();
  }

  markDirty(): void {
    if (this.retired) return;
    this.dirtyRevision++;
    this.start();
  }

  async reconcile(): Promise<void> {
    this.checkDeadlines();
    if (this.confirmed && this.options.monotonicNow() - this.lastVerifiedAt >= 30_000)
      this.markDirty();
    while (this.pending) await this.pending;
    this.checkDeadlines();
  }

  private start(): void {
    if (this.pending) return;
    const revision = this.revision;
    this.pending = Promise.resolve()
      .then(() => this.run())
      .finally(() => {
        this.pending = null;
        if (this.revision !== revision) this.start();
      });
  }

  private async run(): Promise<void> {
    try {
      for (;;) {
        const desired = !this.retired && !this.failed ? this.desired : null;
        const revision = this.revision;
        const key = fingerprint(desired);
        if (this.confirmed?.source === key && key && this.current(desired!)) {
          if (this.verifiedRevision === this.dirtyRevision) return;
          const observed = this.dirtyRevision;
          const original = this.confirmed.binding;
          const current = () => this.revision === revision && this.current(desired!);
          this.uncertainty.sent(this.options.monotonicNow());
          await this.verifyOrigin(desired!, current);
          const verified = await this.query(current);
          await this.verifyOrigin(desired!, current);
          this.uncertainty.responded();
          if (!current()) continue;
          if (JSON.stringify(original) !== JSON.stringify(verified))
            throw new Error('FORWARD_BINDING_CHANGED');
          this.verifiedRevision = observed;
          this.lastVerifiedAt = this.options.monotonicNow();
          continue;
        }
        if (this.mightExist) await this.remove();
        if (!desired || !this.current(desired)) return;
        const beforeDispatch = () => this.revision === revision && this.current(desired);
        this.uncertainty.sent(this.options.monotonicNow());
        await this.verifyOrigin(desired, beforeDispatch);
        if (!beforeDispatch()) {
          this.uncertainty.responded();
          continue;
        }
        this.mightExist = true;
        try {
          await this.options.gateway.forwardParticipant(
            this.sourceRoom,
            this.identity,
            this.destination,
            {
              ...this.context(),
              signal: this.lifetime.signal,
              beforeDispatch,
            },
          );
        } catch (error) {
          if (error instanceof ApiBudgetError && ['ABORTED', 'SUPERSEDED'].includes(error.code)) {
            // These rejections occur before dispatch. No forward effect needs compensating.
            this.mightExist = false;
            this.uncertainty.responded();
            continue;
          }
          if (error instanceof GatewayError && error.outcomeUnknown) this.unknownForward = true;
          throw error;
        }
        if (!beforeDispatch()) {
          this.uncertainty.responded();
          continue;
        }
        const observed = this.dirtyRevision;
        const binding = await this.query(beforeDispatch);
        await this.verifyOrigin(desired, beforeDispatch);
        this.uncertainty.responded();
        if (!beforeDispatch()) continue;
        // Clone SIDs can differ from the origin. Only this destination query supplies the binding.
        this.confirmed = { source: key!, binding };
        this.verifiedRevision = observed;
        this.lastVerifiedAt = this.options.monotonicNow();
        this.changed();
      }
    } catch (error) {
      if (!(error instanceof ApiBudgetError && ['ABORTED', 'SUPERSEDED'].includes(error.code)))
        this.fail('FORWARD_EFFECT_UNCONFIRMED');
      if (this.mightExist) {
        try {
          await this.remove();
        } catch {
          /* Whole generation retirement retains this target. */
        }
      }
    }
  }

  private async verifyOrigin(source: ForwardSource, beforeDispatch: () => boolean): Promise<void> {
    const participant = await this.options.gateway.getParticipant(this.sourceRoom, this.identity, {
      ...this.context(),
      signal: this.lifetime.signal,
      beforeDispatch,
    });
    const track = participant.tracks[0];
    if (
      participant.identity !== this.identity ||
      participant.sid !== source.participantSid ||
      participant.tracks.length !== 1 ||
      track?.sid !== source.trackSid ||
      track.source !==
        (this.options.kind === 'face' ? TrackSource.CAMERA : TrackSource.MICROPHONE) ||
      track.type !== (this.options.kind === 'face' ? TrackType.VIDEO : TrackType.AUDIO)
    )
      throw new Error('FORWARD_ORIGIN_CHANGED');
  }

  private async query(beforeDispatch: () => boolean): Promise<ForwardBinding> {
    const participant = await this.options.gateway.getParticipant(this.destination, this.identity, {
      ...this.context(),
      signal: this.lifetime.signal,
      beforeDispatch,
    });
    const track = participant.tracks[0];
    if (
      participant.identity !== this.identity ||
      !participant.sid ||
      participant.tracks.length !== 1 ||
      !track?.sid ||
      track.source !==
        (this.options.kind === 'face' ? TrackSource.CAMERA : TrackSource.MICROPHONE) ||
      track.type !== (this.options.kind === 'face' ? TrackType.VIDEO : TrackType.AUDIO)
    )
      throw new Error('FORWARD_BINDING_UNCONFIRMED');
    return { mediaIdentity: this.identity, participantSid: participant.sid, trackSid: track.sid };
  }

  private async remove(): Promise<void> {
    this.clearBinding();
    await confirmRemoteRevocation({
      capability: this.options.capability,
      nowEpochSeconds: this.options.epochNowSeconds,
      beforeDispatch: () => this.owns(),
      remove: async (cutoff) => {
        await this.options.gateway.removeParticipant(
          this.destination,
          this.identity,
          cutoff === undefined ? undefined : { revokeTokenTs: cutoff },
          this.context(true),
        );
      },
      absent: async () => {
        try {
          await this.options.gateway.getParticipant(
            this.destination,
            this.identity,
            this.context(true),
          );
          return false;
        } catch (error) {
          if (error instanceof GatewayError && error.code === 'not_found') return true;
          throw error;
        }
      },
    });
    this.mightExist = false;
    this.uncertainty.blockConfirmed();
  }

  private current(source: ForwardSource): boolean {
    try {
      return (
        !this.retired &&
        !this.failed &&
        this.allowed() &&
        fingerprint(this.desired) === fingerprint(source) &&
        fingerprint(this.options.readSource()) === fingerprint(source)
      );
    } catch {
      return false;
    }
  }
  private allowed(): boolean {
    try {
      return this.owns() && this.options.isAllowed();
    } catch {
      return false;
    }
  }
  private context(cleanup = false) {
    return {
      requestId: randomUUID(),
      deadlineMs: this.options.monotonicNow() + 1000,
      priority: cleanup ? ('cleanup' as const) : ('normal' as const),
      beforeDispatch: () => this.owns(),
    };
  }
  private owns(): boolean {
    return this.ownershipKey() === this.ownership;
  }
  private ownershipKey(): string {
    const { publisher: p, receiver: r } = this.options;
    return JSON.stringify([
      p.request,
      p.generation,
      p.serverEpoch,
      p.roomName,
      p.identity,
      p.splitOwnership,
      r.request,
      r.generation,
      r.serverEpoch,
      r.roomName,
      r.identity,
      r.splitOwnership,
    ]);
  }
  private clearBinding(): void {
    if (!this.confirmed) return;
    this.confirmed = null;
    this.changed();
  }
  private changed(): void {
    try {
      this.options.onChanged();
    } catch {
      this.fail('FORWARD_BINDING_DELIVERY_FAILED');
    }
  }
  private fail(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    this.retire();
    try {
      this.options.onFailure(reason);
    } catch {
      /* The local fence remains closed. */
    }
  }
}
