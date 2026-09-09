import type { Generation, MediaGenerationRegistry } from './MediaGenerationRegistry.js';
import { nodePolicyTimer, type PolicyTimer } from './PolicyUncertainty.js';
import type { TrackBinding } from './TrackRegistry.js';
import type { MediaFailureCode, RetireGenerationRequest } from './types.js';

type PlayerScope = Readonly<{ matchId: string; playerId: string }>;
export type LifecycleReport = PlayerScope &
  Readonly<{
    mediaInstanceId: string;
    receiverGeneration: number;
    status: 'ready' | 'recovering' | 'failed' | 'closed';
  }>;
export type LifecycleInspection = Readonly<{
  participantSid: string | null;
  dirty: boolean;
  terminal: boolean;
  lastVerifiedAt: number | null;
  bindings: readonly TrackBinding[];
}>;
export type MediaLifecycleOptions = Readonly<{
  registry: MediaGenerationRegistry;
  inspect: (generation: Generation) => LifecycleInspection | null;
  monotonicNow: () => number;
  timer?: PolicyTimer;
  localRetirementTimeoutMs?: number;
  onFailure: (generation: Generation, code: MediaFailureCode) => void;
  onGameDisconnected: (scope: PlayerScope) => void;
  onRecoveryStarted: (generation: Generation) => void;
  /** The coordinator can end a recovery after an already-reported fatal policy/phase failure. */
  isRecoveryAllowed?: (generation: Generation) => boolean;
}>;
type Recovery = { startedAt: number; baselineSid: string | null; cancel: () => void };

const keyOf = (scope: PlayerScope) => JSON.stringify([scope.matchId, scope.playerId]);

/**
 * Server-internal side port for B's authenticated session and D's scoped lifecycle reports.
 * B must derive match/player/scope from its current authenticated session before calling it.
 * A browser report never confirms Cloud revocation, permissions, tracks, or business readiness.
 */
export class MediaLifecycle {
  private readonly connections = new Map<string, boolean>();
  private readonly retired = new Set<Generation>();
  private readonly recovering = new Map<Generation, Recovery>();
  private readonly failed = new Set<Generation>();
  private readonly waiters = new Map<Generation, Set<(value: boolean) => void>>();
  private closed = false;
  private readonly localRetirementTimeoutMs: number;

  constructor(private readonly options: MediaLifecycleOptions) {
    const timeout = options.localRetirementTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0)
      throw new Error('INVALID_LOCAL_RETIREMENT_TIMEOUT');
    this.localRetirementTimeoutMs = timeout;
  }

  setGameConnection(input: PlayerScope & Readonly<{ connected: boolean }>): void {
    if (this.closed || !input.matchId || !input.playerId || typeof input.connected !== 'boolean')
      return;
    const key = keyOf(input);
    const previous = this.connections.get(key);
    this.connections.set(key, input.connected);
    if (!input.connected) {
      for (const generation of this.recovering.keys()) {
        if (keyOf(generation.request) === key) this.stopRecovery(generation);
      }
      if (previous !== false)
        this.options.onGameDisconnected({ matchId: input.matchId, playerId: input.playerId });
    }
  }

  isGameConnected(matchId: string, playerId: string): boolean {
    return !this.closed && this.connections.get(keyOf({ matchId, playerId })) === true;
  }

  report(input: LifecycleReport): boolean {
    if (this.closed || !['ready', 'recovering', 'failed', 'closed'].includes(input.status))
      return false;
    const generation = this.find(input);
    if (!generation) return false;
    if (input.status === 'closed') {
      this.retired.add(generation);
      // Local disposal is not recovery. Keep the original deadline through remote
      // retirement and the gap before the replacement request arrives.
      this.check(generation);
      for (const finish of this.waiters.get(generation) ?? []) finish(true);
      return true;
    }
    if (
      !this.options.registry.isCurrent(generation) ||
      !this.isGameConnected(input.matchId, input.playerId) ||
      this.retired.has(generation) ||
      this.failed.has(generation)
    )
      return false;
    // A client ready report neither clears a deadline nor verifies any publication.
    if (input.status === 'ready') return true;
    if (this.recovering.has(generation)) {
      this.check(generation);
      return true;
    }
    const now = this.options.monotonicNow();
    const state = this.inspect(generation);
    const recovery: Recovery = {
      startedAt: now,
      baselineSid: state && !state.terminal && state.participantSid ? state.participantSid : null,
      cancel: () => {},
    };
    this.recovering.set(generation, recovery);
    try {
      this.options.onRecoveryStarted(generation);
    } catch {
      // A failed query trigger never establishes recovery evidence.
    }
    this.check(generation);
    return true;
  }

  hasLocalRetirement(generation: Generation): boolean {
    return !this.closed && this.retired.has(generation);
  }

  recoveryStartedAt(generation: Generation): number | null {
    return this.closed ? null : (this.recovering.get(generation)?.startedAt ?? null);
  }

  awaitLocalRetirement(input: RetireGenerationRequest, signal: AbortSignal): Promise<boolean> {
    const generation = this.find(input);
    if (this.closed || signal.aborted || !generation) return Promise.resolve(false);
    if (this.retired.has(generation)) return Promise.resolve(true);
    const startedAt = this.options.monotonicNow();
    if (!Number.isFinite(startedAt)) return Promise.resolve(false);
    const deadline = startedAt + this.localRetirementTimeoutMs;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let cancelTimer: (() => void) | undefined;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        cancelTimer?.();
        signal.removeEventListener('abort', abort);
        const current = this.waiters.get(generation);
        current?.delete(finish);
        if (current?.size === 0) this.waiters.delete(generation);
        const now = this.options.monotonicNow();
        resolve(value && !this.closed && !signal.aborted && now >= startedAt && now < deadline);
      };
      const abort = () => finish(false);
      const arm = () => {
        if (settled) return;
        const now = this.options.monotonicNow();
        if (!Number.isFinite(now) || now < startedAt || now >= deadline) {
          finish(false);
          return;
        }
        cancelTimer = (this.options.timer ?? nodePolicyTimer)(
          arm,
          Math.max(1, Math.ceil(deadline - now)),
        );
      };
      const waiters = this.waiters.get(generation) ?? new Set();
      waiters.add(finish);
      this.waiters.set(generation, waiters);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) finish(false);
      else arm();
    });
  }

  reconcile(): void {
    if (this.closed) return;
    for (const generation of this.recovering.keys()) this.check(generation);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const generation of this.recovering.keys()) this.stopRecovery(generation);
    for (const waiters of this.waiters.values()) for (const finish of waiters) finish(false);
    this.connections.clear();
    this.retired.clear();
    this.failed.clear();
  }

  private find(input: Omit<LifecycleReport, 'status'>): Generation | undefined {
    return this.options.registry
      .all()
      .find(
        (generation) =>
          generation.request.matchId === input.matchId &&
          generation.request.playerId === input.playerId &&
          generation.request.mediaInstanceId === input.mediaInstanceId &&
          generation.generation === input.receiverGeneration,
      );
  }

  private inspect(generation: Generation): LifecycleInspection | null {
    try {
      return this.options.inspect(generation);
    } catch {
      return null;
    }
  }

  private check(generation: Generation): void {
    const recovery = this.recovering.get(generation);
    if (!recovery) return;
    recovery.cancel();
    if (
      this.closed ||
      this.options.isRecoveryAllowed?.(generation) === false ||
      this.options.registry.get(generation.request.matchId, generation.request.playerId) !==
        generation ||
      !this.options.registry.eligible(generation.request) ||
      !this.isGameConnected(generation.request.matchId, generation.request.playerId)
    ) {
      this.stopRecovery(generation);
      return;
    }
    const now = this.options.monotonicNow();
    if (!Number.isFinite(now) || now < recovery.startedAt || now >= recovery.startedAt + 10_000) {
      this.stopRecovery(generation);
      this.failed.add(generation);
      this.options.onFailure(generation, 'TIMEOUT');
      return;
    }
    const state = this.inspect(generation);
    if (
      !generation.terminal &&
      !this.retired.has(generation) &&
      recovery.baselineSid !== null &&
      state &&
      !state.dirty &&
      !state.terminal &&
      state.participantSid === recovery.baselineSid &&
      state.lastVerifiedAt !== null &&
      state.lastVerifiedAt > recovery.startedAt &&
      state.lastVerifiedAt <= now &&
      state.bindings.some(
        (binding) =>
          binding.matchId === generation.request.matchId &&
          binding.playerId === generation.request.playerId &&
          binding.mediaInstanceId === generation.request.mediaInstanceId &&
          binding.mediaIdentity === generation.identity &&
          binding.publisherGeneration === generation.generation &&
          binding.participantSid === recovery.baselineSid &&
          binding.source === 'camera' &&
          binding.verifiedAt > recovery.startedAt &&
          binding.verifiedAt <= now,
      )
    ) {
      this.stopRecovery(generation);
      return;
    }
    recovery.cancel = (this.options.timer ?? nodePolicyTimer)(
      () => this.check(generation),
      Math.max(1, Math.ceil(recovery.startedAt + 10_000 - now)),
    );
  }

  private stopRecovery(generation: Generation): void {
    this.recovering.get(generation)?.cancel();
    this.recovering.delete(generation);
  }
}
