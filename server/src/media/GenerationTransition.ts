import { nodePolicyTimer, type PolicyTimer } from './PolicyUncertainty.js';
import { RequestHistory } from './RequestHistory.js';
import type {
  MediaFailureCode,
  PreparationResult,
  PrepareGenerationRequest,
  RetirementResult,
  RetireGenerationRequest,
} from './types.js';

type PlayerScope = Pick<PrepareGenerationRequest, 'matchId' | 'playerId'>;
type Ready = Extract<PreparationResult, { status: 'ready' }>;
type EndReason = Exclude<RetireGenerationRequest['reason'], 'phase-change' | 'reconnect'>;
type RequestEntry<T> = { fingerprint: string; promise: Promise<T>; result?: T };
type Pending = { key: string; cancel: (code: MediaFailureCode) => void };

export type GenerationTransitionDeps = {
  monotonicNow: () => number;
  timer?: PolicyTimer;
  current: (input: PrepareGenerationRequest) => RetireGenerationRequest | null;
  retire: (input: RetireGenerationRequest) => Promise<RetirementResult>;
  prepare: (input: PrepareGenerationRequest) => Promise<PreparationResult>;
  isActive: (input: PrepareGenerationRequest) => boolean;
  isCurrentScope: (input: RetireGenerationRequest) => boolean;
  validatePrepared: (result: Ready) => boolean;
  /** Cleanup must use the attempted input scope, never trust a malformed producer result. */
  discardPrepared: (result: Ready, input: PrepareGenerationRequest) => void | Promise<void>;
  awaitLocalRetirement?: (input: RetireGenerationRequest, signal: AbortSignal) => Promise<boolean>;
  onBlocked: (input: PrepareGenerationRequest, code: MediaFailureCode) => void;
  onInvalidated?: (scope: PlayerScope, reason: RetireGenerationRequest['reason']) => void;
};

const keyOf = (scope: PlayerScope) => JSON.stringify([scope.matchId, scope.playerId]);
const sameRequestScope = (a: PrepareGenerationRequest, b: PreparationResult) =>
  a.requestId === b.requestId &&
  a.matchId === b.matchId &&
  a.playerId === b.playerId &&
  a.mediaInstanceId === b.mediaInstanceId;

function retirementMatches(input: RetireGenerationRequest, result: RetirementResult): boolean {
  return (
    input.requestId === result.requestId &&
    input.matchId === result.matchId &&
    input.playerId === result.playerId &&
    input.mediaInstanceId === result.mediaInstanceId &&
    input.receiverGeneration === result.receiverGeneration &&
    input.reason === result.reason
  );
}

function rejected(input: PrepareGenerationRequest, code: MediaFailureCode): PreparationResult {
  return Object.freeze({
    requestId: input.requestId,
    matchId: input.matchId,
    playerId: input.playerId,
    mediaInstanceId: input.mediaInstanceId,
    status: 'rejected',
    receiverGeneration: null,
    grant: null,
    code,
  });
}

/** Serializes only media replacement. Logical game scope remains owned by B. */
export class GenerationTransition {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly requests: RequestHistory<RequestEntry<PreparationResult>>;
  private readonly retirements: RequestHistory<RequestEntry<RetirementResult>>;
  private readonly pending = new Set<Pending>();
  private readonly revisions = new Map<string, number>();
  private readonly ended = new Set<string>();
  private closed = false;

  constructor(private readonly deps: GenerationTransitionDeps) {
    this.requests = new RequestHistory(deps.monotonicNow);
    this.retirements = new RequestHistory(deps.monotonicNow);
  }

  prune(): void {
    this.requests.prune();
    this.retirements.prune();
  }

  get retained() {
    return {
      requests: this.requests.retained,
      retirements: this.retirements.retained,
      queues: this.queues.size,
      revisions: this.revisions.size,
      ended: this.ended.size,
    };
  }

  /** The owner has closed authoritative admission for this match before invoking this. */
  forgetMatch(matchId: string): void {
    const match = (key: string) => JSON.parse(key)[0] === matchId;
    for (const pending of this.pending) if (match(pending.key)) pending.cancel('STALE_GENERATION');
    for (const key of this.revisions.keys()) if (match(key)) this.revisions.delete(key);
    for (const key of this.ended) if (match(key)) this.ended.delete(key);
    this.requests.forgetCompleted((entry) => entry.result?.matchId === matchId);
    this.retirements.forgetCompleted((entry) => entry.result?.matchId === matchId);
  }

  isAllowed(matchId: string, playerId: string): boolean {
    return !this.closed && !this.ended.has(keyOf({ matchId, playerId }));
  }

  replace(
    requested: PrepareGenerationRequest,
    options: Readonly<{ recovery?: boolean; recoveryStartedAt?: number }> = {},
  ): Promise<PreparationResult> {
    const input = Object.freeze({ ...requested });
    if (
      !input.requestId ||
      !input.matchId ||
      !input.playerId ||
      !input.mediaInstanceId ||
      !['practice', 'game'].includes(input.purpose) ||
      (input.expectedPreviousGeneration !== null &&
        (!Number.isSafeInteger(input.expectedPreviousGeneration) ||
          input.expectedPreviousGeneration < 1))
    )
      return Promise.resolve(rejected(input, 'WRONG_SCOPE'));
    if (!this.isAllowed(input.matchId, input.playerId))
      return Promise.resolve(rejected(input, 'STALE_GENERATION'));
    const fingerprint = JSON.stringify([
      input.matchId,
      input.playerId,
      input.mediaInstanceId,
      input.purpose,
      input.expectedPreviousGeneration,
      options.recovery === true,
    ]);
    if (this.retirements.has(input.requestId))
      return Promise.resolve(rejected(input, 'WRONG_SCOPE'));
    const cached = this.requests.get(input.requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        return Promise.resolve(rejected(input, 'WRONG_SCOPE'));
      // Only a request that allocated nothing may be retried after READY/OPEN changes.
      if (
        cached.result?.status !== 'rejected' ||
        cached.result.receiverGeneration !== null ||
        cached.result.code !== 'NOT_READY'
      )
        return cached.promise.then((result) =>
          result.status === 'ready' && !this.preparedCurrent(input, result)
            ? rejected(input, 'STALE_GENERATION')
            : result,
        );
    }

    if (!this.requests.canAdd(input.requestId))
      return Promise.resolve(rejected(input, 'NOT_READY'));
    const key = keyOf(input);
    const revision = this.revisions.get(key) ?? 0;
    const receivedAt = this.deps.monotonicNow();
    // Replacing an identity does not restart an already running ordinary recovery window.
    const started =
      options.recovery === true ? (options.recoveryStartedAt ?? receivedAt) : receivedAt;
    const deadline = options.recovery === true ? started + 10_000 : null;
    let settled = false;
    let expired = false;
    const cancellation = new AbortController();
    let cancelTimer: (() => void) | undefined;
    let resolve!: (result: PreparationResult) => void;
    const promise = new Promise<PreparationResult>((done) => {
      resolve = done;
    });
    const entry: RequestEntry<PreparationResult> = { fingerprint, promise };
    const finish = (result: PreparationResult) => {
      if (settled) return;
      settled = true;
      cancelTimer?.();
      cancellation.abort();
      this.pending.delete(pending);
      // Cached grants cannot be mutated by an HTTP consumer after validation.
      entry.result = Object.freeze(
        result.status === 'ready'
          ? { ...result, grant: Object.freeze({ ...result.grant }) }
          : { ...result },
      );
      resolve(entry.result);
    };
    const pending: Pending = { key, cancel: (code) => finish(rejected(input, code)) };
    this.pending.add(pending);
    const timeout = () => {
      if (settled) return;
      expired = true;
      finish(rejected(input, 'TIMEOUT'));
      this.invalidatePlayer(input.matchId, input.playerId, 'connection-lost');
      this.blocked(input, 'TIMEOUT');
    };
    const currentTimeExpired = () => {
      if (deadline === null) return false;
      const now = this.deps.monotonicNow();
      return (
        !Number.isFinite(now) ||
        !Number.isFinite(deadline) ||
        !Number.isFinite(receivedAt) ||
        started > receivedAt ||
        now < started ||
        now >= deadline
      );
    };
    const arm = () => {
      if (settled || deadline === null) return;
      if (!Number.isFinite(started) || currentTimeExpired()) {
        timeout();
        return;
      }
      cancelTimer = (this.deps.timer ?? nodePolicyTimer)(
        arm,
        Math.max(1, Math.ceil(deadline - this.deps.monotonicNow())),
      );
    };
    const alive = () => {
      if (currentTimeExpired()) timeout();
      if (
        settled ||
        expired ||
        !this.isAllowed(input.matchId, input.playerId) ||
        (this.revisions.get(key) ?? 0) !== revision
      )
        return false;
      try {
        return this.deps.isActive(input);
      } catch {
        return false;
      }
    };
    this.requests.set(input.requestId, entry);
    arm();
    const work = this.enqueue(key, async (): Promise<PreparationResult> => {
      if (!alive()) return rejected(input, expired ? 'TIMEOUT' : 'STALE_GENERATION');
      const previous = this.deps.current(input);
      if (
        (previous?.receiverGeneration ?? null) !== input.expectedPreviousGeneration ||
        (previous && (previous.matchId !== input.matchId || previous.playerId !== input.playerId))
      )
        return rejected(input, 'STALE_GENERATION');
      if (previous) {
        const retirement = Object.freeze({ ...previous });
        const result = await this.deps.retire(retirement);
        if (!alive()) return rejected(input, expired ? 'TIMEOUT' : 'STALE_GENERATION');
        if (
          !retirementMatches(retirement, result) ||
          result.status !== 'confirmed' ||
          result.code !== null
        ) {
          this.blocked(input, 'RETIREMENT_UNCONFIRMED');
          return {
            ...rejected(input, 'RETIREMENT_UNCONFIRMED'),
            status: 'unknown',
            receiverGeneration: previous.receiverGeneration,
            grant: null,
            code: 'RETIREMENT_UNCONFIRMED',
          };
        }
        // D's local disposal is separate evidence; remote ACK cannot stand in for it.
        const locallyRetired =
          (await this.deps.awaitLocalRetirement?.(retirement, cancellation.signal)) ?? false;
        if (!alive()) return rejected(input, expired ? 'TIMEOUT' : 'STALE_GENERATION');
        if (!locallyRetired) {
          this.blocked(input, 'RETIREMENT_UNCONFIRMED');
          return {
            ...rejected(input, 'RETIREMENT_UNCONFIRMED'),
            status: 'unknown',
            receiverGeneration: previous.receiverGeneration,
            grant: null,
            code: 'RETIREMENT_UNCONFIRMED',
          };
        }
      }
      if (!alive()) return rejected(input, expired ? 'TIMEOUT' : 'STALE_GENERATION');
      const result = await this.deps.prepare(input);
      if (
        !alive() ||
        !sameRequestScope(input, result) ||
        (result.status === 'ready' &&
          (result.receiverGeneration !== (input.expectedPreviousGeneration ?? 0) + 1 ||
            !this.preparedCurrent(input, result)))
      ) {
        if (result.status === 'ready') await this.deps.discardPrepared(result, input);
        return rejected(input, expired ? 'TIMEOUT' : 'STALE_GENERATION');
      }
      if (result.status === 'unknown') this.blocked(input, result.code);
      return result;
    });
    void work
      .then(finish, () => {
        this.blocked(input, 'RETIREMENT_UNCONFIRMED');
        finish(rejected(input, 'RETIREMENT_UNCONFIRMED'));
      })
      .finally(() => this.requests.settle(input.requestId, entry));
    return promise;
  }

  retire(requested: RetireGenerationRequest): Promise<RetirementResult> {
    const input = Object.freeze({ ...requested });
    const failure = (code: MediaFailureCode): RetirementResult =>
      Object.freeze({ ...input, status: 'unknown', code });
    if (this.closed) return Promise.resolve(failure('STALE_GENERATION'));
    if (
      !input.requestId ||
      !input.matchId ||
      !input.playerId ||
      !input.mediaInstanceId ||
      !Number.isSafeInteger(input.receiverGeneration) ||
      input.receiverGeneration < 1 ||
      ![
        'phase-change',
        'personal-ended',
        'connection-lost',
        'policy-unknown',
        'round-ended',
        'reconnect',
        'shutdown',
      ].includes(input.reason)
    )
      return Promise.resolve(failure('WRONG_SCOPE'));
    const fingerprint = JSON.stringify([
      input.matchId,
      input.playerId,
      input.mediaInstanceId,
      input.receiverGeneration,
      input.reason,
    ]);
    const cached = this.retirements.get(input.requestId);
    if (cached)
      return cached.fingerprint === fingerprint
        ? cached.promise
        : Promise.resolve(failure('WRONG_SCOPE'));
    if (this.requests.has(input.requestId)) return Promise.resolve(failure('WRONG_SCOPE'));
    // Delayed retirement for an old generation may clean that generation only.
    try {
      if (this.deps.isCurrentScope(input)) this.invalidate(input, input.reason);
    } catch {
      return Promise.resolve(failure('STALE_GENERATION'));
    }
    const promise = this.enqueue(keyOf(input), async () => {
      try {
        const result = await this.deps.retire(input);
        return retirementMatches(input, result) &&
          (result.status !== 'confirmed' || result.code === null)
          ? Object.freeze({ ...result })
          : failure('RETIREMENT_UNCONFIRMED');
      } catch {
        return failure('RETIREMENT_UNCONFIRMED');
      }
    });
    const entry: RequestEntry<RetirementResult> = { fingerprint, promise };
    // A full retry cache must never suppress remote revocation. The coordinator/barrier
    // still deduplicates in-flight work by Generation when this request is uncached.
    this.retirements.set(input.requestId, entry);
    void promise.then(
      (result) => {
        entry.result = result;
        this.retirements.settle(input.requestId, entry);
      },
      () => this.retirements.settle(input.requestId, entry),
    );
    return promise;
  }

  invalidatePlayer(matchId: string, playerId: string, reason: EndReason): void {
    this.invalidate({ matchId, playerId }, reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending) pending.cancel('STALE_GENERATION');
  }

  private invalidate(scope: PlayerScope, reason: RetireGenerationRequest['reason']): void {
    const key = keyOf(scope);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    if (reason !== 'phase-change' && reason !== 'reconnect') this.ended.add(key);
    for (const pending of this.pending)
      if (pending.key === key)
        pending.cancel(reason === 'policy-unknown' ? 'POLICY_UNKNOWN' : 'STALE_GENERATION');
    try {
      this.deps.onInvalidated?.(scope, reason);
    } catch {
      // The local latch still prevents issuing even when notification fails.
    }
  }

  private enqueue<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const promise = (this.queues.get(key) ?? Promise.resolve()).then(callback);
    const tail = promise.catch(() => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return promise;
  }

  private preparedCurrent(input: PrepareGenerationRequest, result: Ready): boolean {
    try {
      const current = this.deps.current(input);
      return (
        this.isAllowed(input.matchId, input.playerId) &&
        this.deps.isActive(input) &&
        current?.matchId === input.matchId &&
        current.playerId === input.playerId &&
        current.mediaInstanceId === result.mediaInstanceId &&
        current.receiverGeneration === result.receiverGeneration &&
        result.grant.matchId === result.matchId &&
        result.grant.mediaInstanceId === result.mediaInstanceId &&
        result.grant.receiverGeneration === result.receiverGeneration &&
        this.deps.validatePrepared(result)
      );
    } catch {
      return false;
    }
  }

  private blocked(input: PrepareGenerationRequest, code: MediaFailureCode): void {
    if (this.closed) return;
    try {
      this.deps.onBlocked(input, code);
    } catch {
      // Observer failures cannot promote a failed transition into a ready grant.
    }
  }
}
