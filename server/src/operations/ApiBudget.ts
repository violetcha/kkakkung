export type ApiPriority = 'normal' | 'cleanup';
export type ApiKind = 'grant' | 'revoke' | 'query' | 'room';

export class ApiBudgetError extends Error {
  constructor(
    readonly code:
      | 'DEADLINE_EXCEEDED'
      | 'CLOSED'
      | 'NORMAL_LOCKED'
      | 'ABORTED'
      | 'SUPERSEDED'
      | 'INVALID_CLOCK'
      | 'INVALID_REQUEST',
  ) {
    super(code);
    this.name = 'ApiBudgetError';
  }
}

export type ApiBudgetSnapshot = Readonly<{
  total60s: number;
  normal60s: number;
  pendingNormal: number;
  pendingCleanup: number;
  inFlight: number;
  normalLocked: boolean;
  closed: boolean;
}>;

export type ApiDispatch<T> = Readonly<{
  requestId: string;
  method: string;
  target: string;
  kind: ApiKind;
  priority: ApiPriority;
  /** Absolute monotonic milliseconds, not an epoch timestamp. */
  deadlineMs: number;
  run: () => Promise<T>;
  beforeDispatch?: () => boolean;
  signal?: AbortSignal;
}>;

export type ApiBudgetOptions = Readonly<{
  monotonicNow: () => number;
  maxNormalCallsPer60s: number;
  maxTotalCallsPer60s: number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onSnapshot?: (snapshot: ApiBudgetSnapshot) => void;
}>;

type Pending = {
  priority: ApiPriority;
  deadlineMs: number;
  start: () => void;
  reject: (error: ApiBudgetError) => void;
  detach: () => void;
  beforeDispatch: () => boolean;
  isAborted: () => boolean;
};

/** One instance must be shared by every RoomService call for a Cloud project. */
export class ApiBudget {
  private readonly sent: { at: number; priority: ApiPriority }[] = [];
  private pending: Pending[] = [];
  private inFlight = 0;
  private normalLocked = false;
  private closed = false;
  private timer: unknown;
  private lastNow = -Infinity;
  private pumping = false;
  private readonly setTimer: NonNullable<ApiBudgetOptions['setTimer']>;
  private readonly clearTimer: NonNullable<ApiBudgetOptions['clearTimer']>;

  constructor(private readonly options: ApiBudgetOptions) {
    const { maxNormalCallsPer60s: normal, maxTotalCallsPer60s: total } = options;
    if (
      !Number.isSafeInteger(normal) ||
      !Number.isSafeInteger(total) ||
      normal <= 0 ||
      normal > 600 ||
      total < normal ||
      total > 900 ||
      Boolean(options.setTimer) !== Boolean(options.clearTimer)
    ) {
      throw new Error('INVALID_API_BUDGET_CONFIG');
    }
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  dispatch<T>(request: ApiDispatch<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (
        !request.requestId ||
        !request.method ||
        !request.target ||
        !Number.isFinite(request.deadlineMs) ||
        !['normal', 'cleanup'].includes(request.priority) ||
        !['grant', 'revoke', 'query', 'room'].includes(request.kind)
      ) {
        reject(new ApiBudgetError('INVALID_REQUEST'));
        return;
      }
      if (this.closed || (this.normalLocked && request.priority === 'normal')) {
        reject(new ApiBudgetError(this.closed ? 'CLOSED' : 'NORMAL_LOCKED'));
        return;
      }
      if (request.signal?.aborted) {
        reject(new ApiBudgetError('ABORTED'));
        return;
      }
      const abort = () => {
        const index = this.pending.indexOf(entry);
        if (index < 0) return; // Already sent: its remote result is still authoritative.
        this.pending.splice(index, 1);
        entry.detach();
        reject(new ApiBudgetError('ABORTED'));
        this.pump();
      };
      const entry: Pending = {
        priority: request.priority,
        deadlineMs: request.deadlineMs,
        reject,
        detach: () => request.signal?.removeEventListener('abort', abort),
        beforeDispatch: request.beforeDispatch ?? (() => true),
        isAborted: () => request.signal?.aborted === true,
        start: () => {
          this.inFlight += 1;
          // Count immediately before invoking the transport, including synchronous failures.
          let response: Promise<T>;
          try {
            response = request.run();
          } catch (error) {
            response = Promise.reject(error);
          }
          void response.then(
            (value) => {
              this.inFlight -= 1;
              this.publish();
              resolve(value);
            },
            (error: unknown) => {
              this.inFlight -= 1;
              this.publish();
              reject(error);
            },
          );
        },
      };
      this.pending.push(entry);
      request.signal?.addEventListener('abort', abort, { once: true });
      this.pump();
    });
  }

  /** Deny queued/new ordinary work while allowing shutdown and recovery cleanup. */
  lockNormal(): void {
    this.normalLocked = true;
    this.rejectWaiting((entry) => entry.priority === 'normal', 'NORMAL_LOCKED');
    this.pump();
  }

  unlockNormal(): void {
    if (this.closed) throw new ApiBudgetError('CLOSED');
    this.normalLocked = false;
    this.publish();
  }

  /** Only waiting requests are cancelled. Callers must still await sent calls. */
  close(): void {
    this.closed = true;
    this.normalLocked = true;
    this.cancelTimer();
    this.rejectWaiting(() => true, 'CLOSED');
    this.publish();
  }

  getSnapshot(): ApiBudgetSnapshot {
    this.prune(this.now());
    return this.snapshot();
  }

  private now(): number {
    const value = this.options.monotonicNow();
    if (!Number.isFinite(value) || value < 0 || value < this.lastNow) {
      throw new ApiBudgetError('INVALID_CLOCK');
    }
    this.lastNow = value;
    return value;
  }

  private prune(now: number): void {
    while (this.sent[0] && this.sent[0].at <= now - 60_000) this.sent.shift();
  }

  private pump(): void {
    // Scope/transport callbacks may enqueue more work synchronously. A nested
    // pump must not consume capacity between this pump's check and its send.
    if (this.pumping) return;
    this.pumping = true;
    try {
      this.pumpWaiting();
    } finally {
      this.pumping = false;
    }
    // A metric callback at the end of the pass may have queued work after the
    // dispatch loop. Process any available slot now; retain timers for full windows.
    if (
      !this.closed &&
      this.pending.length > 0 &&
      (this.timer === undefined ||
        this.pending.some(
          (entry) =>
            this.sent.length <
            (entry.priority === 'normal'
              ? this.options.maxNormalCallsPer60s
              : this.options.maxTotalCallsPer60s),
        ))
    )
      this.pump();
  }

  private pumpWaiting(): void {
    this.cancelTimer();
    let now: number;
    try {
      now = this.now();
    } catch {
      this.closed = true;
      this.normalLocked = true;
      this.rejectWaiting(() => true, 'INVALID_CLOCK');
      this.publish();
      return;
    }
    this.prune(now);
    this.rejectWaiting((entry) => entry.deadlineMs <= now, 'DEADLINE_EXCEEDED');
    // Stable sort preserves FIFO among requests of equal priority.
    this.pending.sort(
      (a, b) => Number(b.priority === 'cleanup') - Number(a.priority === 'cleanup'),
    );
    while (this.pending.length > 0 && !this.closed) {
      const entry = this.pending[0]!;
      const limit =
        entry.priority === 'normal'
          ? this.options.maxNormalCallsPer60s
          : this.options.maxTotalCallsPer60s;
      if (this.sent.length >= limit) break;
      this.pending.shift();
      entry.detach();
      let current = false;
      try {
        current = entry.beforeDispatch();
      } catch {
        // A failed scope check denies dispatch just like a stale generation.
      }
      if (!current) {
        entry.reject(new ApiBudgetError('SUPERSEDED'));
        continue;
      }
      try {
        now = this.now();
      } catch {
        this.closed = true;
        this.normalLocked = true;
        entry.reject(new ApiBudgetError('INVALID_CLOCK'));
        this.rejectWaiting(() => true, 'INVALID_CLOCK');
        break;
      }
      if (entry.isAborted() || entry.deadlineMs <= now) {
        entry.reject(new ApiBudgetError(entry.isAborted() ? 'ABORTED' : 'DEADLINE_EXCEEDED'));
        continue;
      }
      if (this.closed || (this.normalLocked && entry.priority === 'normal')) {
        entry.reject(new ApiBudgetError(this.closed ? 'CLOSED' : 'NORMAL_LOCKED'));
        continue;
      }
      this.sent.push({ at: now, priority: entry.priority });
      entry.start();
      // A transport may enqueue another request or close this budget synchronously.
      try {
        now = this.now();
      } catch {
        this.closed = true;
        this.normalLocked = true;
        this.rejectWaiting(() => true, 'INVALID_CLOCK');
        break;
      }
      this.prune(now);
      this.rejectWaiting((queued) => queued.deadlineMs <= now, 'DEADLINE_EXCEEDED');
    }
    if (this.pending.length > 0 && !this.closed) {
      const earliestDeadline = this.pending.reduce(
        (minimum, entry) => Math.min(minimum, entry.deadlineMs),
        Infinity,
      );
      const release = (this.sent[0]?.at ?? now) + 60_000;
      this.timer = this.setTimer(
        () => {
          this.timer = undefined;
          this.pump();
        },
        Math.max(1, Math.min(release, earliestDeadline) - now),
      );
    }
    this.publish();
  }

  private rejectWaiting(
    predicate: (entry: Pending) => boolean,
    code: ApiBudgetError['code'],
  ): void {
    this.pending = this.pending.filter((entry) => {
      if (!predicate(entry)) return true;
      entry.detach();
      entry.reject(new ApiBudgetError(code));
      return false;
    });
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private snapshot(): ApiBudgetSnapshot {
    return {
      total60s: this.sent.length,
      normal60s: this.sent.filter((entry) => entry.priority === 'normal').length,
      pendingNormal: this.pending.filter((entry) => entry.priority === 'normal').length,
      pendingCleanup: this.pending.filter((entry) => entry.priority === 'cleanup').length,
      inFlight: this.inFlight,
      normalLocked: this.normalLocked,
      closed: this.closed,
    };
  }

  private publish(): void {
    try {
      this.options.onSnapshot?.(this.snapshot());
    } catch {
      // Metrics must not change dispatch decisions or manufacture remote success.
    }
  }
}
