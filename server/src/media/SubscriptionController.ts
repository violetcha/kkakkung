import { randomUUID } from 'node:crypto';
import { GatewayError } from './LiveKitGateway.js';
import { PolicyUncertainty, type PolicyTimer } from './PolicyUncertainty.js';
import type { MediaScope, MetricSample } from './types.js';

export type SubscriptionKey = MediaScope &
  Readonly<{
    playerId: string;
    mediaRoomName: string;
    receiverIdentity: string;
  }>;
export type SubscriptionRequest = Readonly<{
  key: SubscriptionKey;
  requestId: string;
  trackSids: readonly string[];
  subscribe: boolean;
  /** Scheduler must call this immediately before its one SDK dispatch. */
  beforeDispatch: () => boolean;
}>;
export type SubscriptionDependencies = Readonly<{
  now: () => number;
  timer?: PolicyTimer;
  /** Only allow acknowledgements may use a longer window; block deadlines remain 1s. */
  allowResponseTimeoutMs?: number;
  onDiagnostic?: (input: {
    requestId: string | null;
    generation: number;
    stage: string;
    code: string;
    durationMs: number;
  }) => void;
  send: (request: SubscriptionRequest) => Promise<void>;
  validateKey: (key: SubscriptionKey) => boolean;
  validateTrack: (key: SubscriptionKey, trackSid: string) => boolean;
  getTrackFingerprint: (key: SubscriptionKey, trackSid: string) => string | null;
  onUnknown: (key: SubscriptionKey, requestId: string | null) => void;
  emitMetric?: (sample: MetricSample) => void;
  onLateResponse?: (input: {
    requestId: string;
    receiverGeneration: number;
    outcome: 'resolved' | 'rejected';
  }) => void;
}>;
type RequestState = {
  id: string;
  tracks: string[];
  bindings: Map<string, string>;
  subscribe: boolean;
  sentAt: number | null;
};
type TargetState = {
  key: SubscriptionKey;
  desired: Set<string>;
  acknowledged: Set<string>;
  desiredBindings: Map<string, string>;
  acknowledgedBindings: Map<string, string>;
  policyVersion: number;
  generatedAtMs: number;
  requestSerial: number;
  inFlight: RequestState | null;
  terminal: boolean;
  uncertainty: PolicyUncertainty;
};

export class SubscriptionController {
  private readonly targets = new Map<string, TargetState>();
  constructor(private readonly deps: SubscriptionDependencies) {}

  setDesired(input: {
    key: SubscriptionKey;
    policyVersion: number;
    trackSids: readonly string[];
    generatedAtMs: number;
  }): void {
    const id = this.id(input.key);
    let target = this.targets.get(id);
    if (!target) {
      const state = {
        key: input.key,
        desired: new Set<string>(),
        acknowledged: new Set<string>(),
        desiredBindings: new Map<string, string>(),
        acknowledgedBindings: new Map<string, string>(),
        policyVersion: -1,
        generatedAtMs: input.generatedAtMs,
        requestSerial: 0,
        inFlight: null,
        terminal: false,
      };
      const uncertainty = new PolicyUncertainty(
        this.deps.now,
        (reason) => {
          const current = this.targets.get(id);
          if (!current || current.terminal) return;
          this.diagnostic(
            current,
            current.inFlight?.subscribe ? 'allow-terminal' : 'block-terminal',
            reason,
          );
          current.terminal = true;
          current.desired.clear();
          try {
            this.deps.onUnknown(current.key, current.inFlight?.id ?? null);
          } catch {
            /* The terminal latch remains closed even if the observer fails. */
          }
        },
        this.deps.timer,
      );
      target = { ...state, uncertainty };
      this.targets.set(id, target);
    }
    if (target.terminal || input.policyVersion <= target.policyVersion) return;
    target.policyVersion = input.policyVersion;
    target.generatedAtMs = input.generatedAtMs;
    target.desired = new Set(
      input.trackSids.filter((sid) => this.deps.validateTrack(input.key, sid)),
    );
    target.desiredBindings = new Map();
    for (const sid of target.desired) {
      const binding = this.deps.getTrackFingerprint(input.key, sid);
      if (binding) target.desiredBindings.set(sid, binding);
      else target.desired.delete(sid);
    }
    this.updateBlockDeadline(target);
    this.drain(target);
  }

  retire(key: SubscriptionKey): void {
    const target = this.targets.get(this.id(key));
    if (!target) return;
    target.terminal = true;
    target.desired.clear();
    target.uncertainty.dispose();
    // inFlight is consumed below; retirement is free to perform exceptional remote cleanup.
  }
  forget(key: SubscriptionKey): void {
    this.retire(key);
    this.targets.delete(this.id(key));
  }
  get retained() {
    return this.targets.size;
  }
  checkDeadlines(): void {
    for (const target of this.targets.values()) target.uncertainty.check();
  }
  drainPending(): void {
    for (const target of this.targets.values()) this.drain(target);
  }
  dispose(): void {
    for (const target of this.targets.values()) this.retire(target.key);
  }
  inspect(key: SubscriptionKey) {
    const state = this.targets.get(this.id(key));
    return state
      ? {
          desiredTracks: [...state.desired],
          acknowledgedTracks: [...state.acknowledged],
          policyVersion: state.policyVersion,
          requestSerial: state.requestSerial,
          inFlight: state.inFlight?.id ?? null,
          terminal: state.terminal,
          receptionVerified: false as const,
        }
      : null;
  }

  private drain(target: TargetState): void {
    target.uncertainty.check();
    if (target.terminal || target.inFlight) return;
    if (!this.deps.validateKey(target.key)) {
      // Lost permission must reach the owner's remote retirement path. A local terminal
      // flag alone leaves previously acknowledged subscriptions active indefinitely.
      target.uncertainty.fail();
      return;
    }
    target.desired = new Set(
      [...target.desired].filter(
        (sid) =>
          this.deps.validateTrack(target.key, sid) &&
          this.deps.getTrackFingerprint(target.key, sid) === target.desiredBindings.get(sid),
      ),
    );
    const remove = [...target.acknowledged].filter(
      (sid) =>
        !target.desired.has(sid) ||
        target.acknowledgedBindings.get(sid) !== target.desiredBindings.get(sid),
    );
    const add = [...target.desired].filter((sid) => !target.acknowledged.has(sid));
    this.updateBlockDeadline(target);
    if (target.terminal || (!remove.length && !add.length)) return;
    const request: RequestState = {
      id: randomUUID(),
      tracks: remove.length ? remove : add,
      bindings: new Map(target.desiredBindings),
      subscribe: !remove.length,
      sentAt: null,
    };
    target.requestSerial++;
    target.inFlight = request;
    let permitted = false;
    let dispatchChecked = false;
    const beforeDispatch = () => {
      dispatchChecked = true;
      target.uncertainty.check();
      if (
        permitted ||
        target.terminal ||
        target.inFlight !== request ||
        !this.deps.validateKey(target.key)
      )
        return false;
      if (
        request.subscribe &&
        request.tracks.some(
          (sid) =>
            !target.desired.has(sid) ||
            !this.deps.validateTrack(target.key, sid) ||
            this.deps.getTrackFingerprint(target.key, sid) !== request.bindings.get(sid),
        )
      )
        return false;
      permitted = true;
      request.sentAt = this.deps.now();
      target.uncertainty.sent(
        request.sentAt,
        request.subscribe ? (this.deps.allowResponseTimeoutMs ?? 1000) : 1000,
      );
      this.metric(
        'media.policy.queueWait',
        request.sentAt - target.generatedAtMs,
        target,
        request.id,
      );
      return !target.terminal;
    };
    void Promise.resolve()
      .then(() =>
        this.deps.send({
          key: target.key,
          requestId: request.id,
          trackSids: request.tracks,
          subscribe: request.subscribe,
          beforeDispatch,
        }),
      )
      .then(
        () => {
          target.uncertainty.check();
          if (target.terminal || target.inFlight !== request) {
            this.lateResponse(target, request.id, 'resolved');
            return;
          }
          if (!this.deps.validateKey(target.key)) {
            target.uncertainty.fail();
            return;
          }
          if (!permitted) {
            target.inFlight = null;
            if (!dispatchChecked) {
              target.uncertainty.fail();
              return;
            }
            // A stale queued batch may have been discarded; converge to the newest target.
            this.drain(target);
            return;
          }
          target.uncertainty.responded();
          if (target.terminal) return;
          for (const sid of request.tracks) {
            if (request.subscribe) {
              target.acknowledged.add(sid);
              target.acknowledgedBindings.set(sid, request.bindings.get(sid)!);
            } else {
              target.acknowledged.delete(sid);
              target.acknowledgedBindings.delete(sid);
            }
          }
          this.metric(
            'media.policy.responseLatency',
            this.deps.now() - request.sentAt!,
            target,
            request.id,
          );
          target.inFlight = null;
          this.updateBlockDeadline(target);
          this.drain(target);
        },
        (error: unknown) => {
          this.diagnostic(
            target,
            request.subscribe ? 'allow-rejected' : 'block-rejected',
            error instanceof GatewayError &&
              [
                'not_found',
                'permission_denied',
                'unauthenticated',
                'resource_exhausted',
                'unavailable',
                'internal',
                'unknown',
                'deadline_exceeded',
                'invalid_argument',
                'already_exists',
                'failed_precondition',
                'TRANSPORT_ERROR',
                'REMOTE_ERROR',
              ].includes(error.code)
              ? error.code
              : 'REQUEST_FAILED',
          );
          if (target.terminal || target.inFlight !== request) {
            this.lateResponse(target, request.id, 'rejected');
            return;
          }
          if (permitted) target.uncertainty.fail();
          else {
            target.inFlight = null;
            target.uncertainty.check();
            if (
              request.subscribe &&
              request.tracks.some(
                (sid) =>
                  !target.desired.has(sid) ||
                  !this.deps.validateTrack(target.key, sid) ||
                  this.deps.getTrackFingerprint(target.key, sid) !== request.bindings.get(sid),
              )
            )
              this.drain(target);
          }
        },
      );
  }

  private updateBlockDeadline(target: TargetState): void {
    const mustBlock =
      [...target.acknowledged].some(
        (sid) =>
          !target.desired.has(sid) ||
          target.acknowledgedBindings.get(sid) !== target.desiredBindings.get(sid),
      ) ||
      (target.inFlight?.subscribe &&
        target.inFlight.tracks.some(
          (sid) =>
            !target.desired.has(sid) ||
            target.inFlight!.bindings.get(sid) !== target.desiredBindings.get(sid),
        ));
    if (mustBlock) {
      target.uncertainty.requireBlock(target.generatedAtMs);
    } else target.uncertainty.blockConfirmed();
  }
  private metric(name: string, value: number, state: TargetState, requestId: string): void {
    try {
      this.deps.emitMetric?.({
        name,
        value,
        unit: 'ms',
        atMs: this.deps.now(),
        generation: state.key.receiverGeneration,
        requestId,
      });
    } catch {
      /* Metrics cannot break control. */
    }
  }
  private lateResponse(
    state: TargetState,
    requestId: string,
    outcome: 'resolved' | 'rejected',
  ): void {
    this.diagnostic(state, 'late-response', outcome);
    try {
      this.deps.onLateResponse?.({
        requestId,
        receiverGeneration: state.key.receiverGeneration,
        outcome,
      });
    } catch {
      /* Diagnostics cannot reopen or break a terminal target. */
    }
  }
  private diagnostic(state: TargetState, stage: string, code: string): void {
    try {
      this.deps.onDiagnostic?.({
        requestId: state.inFlight?.id ?? null,
        generation: state.key.receiverGeneration,
        stage,
        code,
        durationMs: state.inFlight?.sentAt == null ? 0 : this.deps.now() - state.inFlight.sentAt,
      });
    } catch {
      /* Diagnostics cannot affect permission control. */
    }
  }
  private id(key: SubscriptionKey): string {
    return JSON.stringify([
      key.mediaInstanceId,
      key.mediaRoomName,
      key.receiverIdentity,
      key.receiverGeneration,
    ]);
  }
}
