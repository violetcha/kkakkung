export type RetryIntent = Readonly<{
  retirementId: string;
  reservationId: string;
  identity: string;
  generation: number;
  firstRetireEpochMs: number;
  lastAttemptEpochMs: number | null;
  nextAttemptEpochMs: number | null;
  attempt: number;
  status: 'REVOKING' | 'REVOKED' | 'UNRESOLVED';
  alarmed: boolean;
  providerWaitUnknown: boolean;
}>;

export type RetryAttemptResult =
  | Readonly<{ status: 'confirmed' }>
  | Readonly<{ status: 'blocked' }>
  | Readonly<{ status: 'retry'; retryAfterMs?: number }>;

export type RevocationRetryOptions = Readonly<{
  monotonicNow: () => number;
  epochNowMs: () => number;
  /** Must resolve only after the intent/REVOKED state is durable. */
  persist: (intent: RetryIntent) => Promise<void>;
  /** One attempt via the cleanup budget with fresh cutoff. Invoke the guard at actual dispatch,
   * after all asynchronous persistence and budget waits. */
  send: (
    intent: RetryIntent,
    context: Readonly<{ beforeDispatch: () => void }>,
  ) => Promise<RetryAttemptResult>;
  isTerminal: (intent: RetryIntent) => boolean;
  /** May mark occupancy ended; official usage reservations must remain until reconciliation. */
  onConfirmed: (intent: RetryIntent) => Promise<void>;
  onUnresolved: (intent: RetryIntent) => void;
  onPersistenceFailure?: () => void;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}>;

type Entry = {
  intent: RetryIntent;
  deadlineMs: number;
  nextAttemptMs: number | null;
  retryTimer: unknown;
  alarmTimer: unknown;
  sending: boolean;
  pendingWrites: number;
  writes: Promise<void>;
};

const DELAYS = [1_000, 2_000, 4_000] as const;

function validIntent(input: RetryIntent): void {
  const keys = [
    'retirementId',
    'reservationId',
    'identity',
    'generation',
    'firstRetireEpochMs',
    'lastAttemptEpochMs',
    'nextAttemptEpochMs',
    'attempt',
    'status',
    'alarmed',
    'providerWaitUnknown',
  ];
  if (
    !input ||
    Object.keys(input).length !== keys.length ||
    !Object.keys(input).every((key) => keys.includes(key)) ||
    ![input.retirementId, input.reservationId, input.identity].every(
      (value) => typeof value === 'string' && value.length > 0 && value.length <= 256,
    ) ||
    !Number.isSafeInteger(input.generation) ||
    input.generation < 1 ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 0 ||
    !Number.isSafeInteger(input.firstRetireEpochMs) ||
    input.firstRetireEpochMs < 0 ||
    [input.lastAttemptEpochMs, input.nextAttemptEpochMs].some(
      (value) =>
        value !== null && (!Number.isSafeInteger(value) || value < input.firstRetireEpochMs),
    ) ||
    !['REVOKING', 'REVOKED', 'UNRESOLVED'].includes(input.status) ||
    typeof input.alarmed !== 'boolean' ||
    typeof input.providerWaitUnknown !== 'boolean' ||
    (input.providerWaitUnknown && input.status !== 'UNRESOLVED') ||
    (input.status === 'REVOKING' && input.alarmed) ||
    (input.status === 'REVOKED' && input.nextAttemptEpochMs !== null) ||
    (input.lastAttemptEpochMs !== null &&
      input.nextAttemptEpochMs !== null &&
      input.nextAttemptEpochMs < input.lastAttemptEpochMs)
  )
    throw new Error('INVALID_RETRY_INTENT');
}

export function validateRetryIntent(input: unknown): RetryIntent {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('INVALID_RETRY_INTENT');
  validIntent(input as RetryIntent);
  return Object.freeze({ ...input }) as RetryIntent;
}

/** Bounded recovery of an already failed retirement; the initial E-10 request is not repeated here. */
export class RevocationRetries {
  private readonly entries = new Map<string, Entry>();
  private readonly active = new Set<Promise<unknown>>();
  private closed = false;
  private failed = false;
  private readonly setTimer: NonNullable<RevocationRetryOptions['setTimer']>;
  private readonly clearTimer: NonNullable<RevocationRetryOptions['clearTimer']>;

  constructor(private readonly options: RevocationRetryOptions) {
    if (Boolean(options.setTimer) !== Boolean(options.clearTimer)) {
      throw new Error('INVALID_RETRY_TIMER_CONFIGURATION');
    }
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  async begin(input: {
    retirementId: string;
    reservationId: string;
    identity: string;
    generation: number;
    firstRetireEpochMs?: number;
    retryAfterMs?: number;
    providerWaitUnknown?: boolean;
  }): Promise<RetryIntent> {
    if (this.closed) throw new Error('RETRIES_CLOSED');
    const existing = this.entries.get(input.retirementId);
    if (existing) {
      if (
        existing.intent.reservationId !== input.reservationId ||
        existing.intent.identity !== input.identity ||
        existing.intent.generation !== input.generation
      )
        throw new Error('RETIREMENT_ID_CONFLICT');
      await existing.writes;
      return existing.intent;
    }
    const nowEpochMs = this.options.epochNowMs();
    const firstRetireEpochMs = input.firstRetireEpochMs ?? nowEpochMs;
    if (firstRetireEpochMs > nowEpochMs) throw new Error('INVALID_RETRY_CLOCK');
    if (
      input.retryAfterMs !== undefined &&
      (!Number.isFinite(input.retryAfterMs) || input.retryAfterMs < 0)
    )
      throw new Error('INVALID_PROVIDER_WAIT');
    if (input.providerWaitUnknown !== undefined && typeof input.providerWaitUnknown !== 'boolean')
      throw new Error('INVALID_PROVIDER_WAIT');
    const providerWaitUnknown = input.providerWaitUnknown === true;
    const intent: RetryIntent = {
      retirementId: input.retirementId,
      reservationId: input.reservationId,
      identity: input.identity,
      generation: input.generation,
      firstRetireEpochMs,
      lastAttemptEpochMs: null,
      nextAttemptEpochMs: providerWaitUnknown
        ? null
        : nowEpochMs + Math.ceil(Math.max(DELAYS[0], input.retryAfterMs ?? 0)),
      attempt: 0,
      status: providerWaitUnknown ? 'UNRESOLVED' : 'REVOKING',
      alarmed: providerWaitUnknown,
      providerWaitUnknown,
    };
    validIntent(intent);
    const entry = this.createEntry(intent);
    this.entries.set(intent.retirementId, entry);
    await this.write(entry, () => intent);
    if (providerWaitUnknown) {
      try {
        this.options.onUnresolved(entry.intent);
      } catch {
        /* Durable unresolved state remains authoritative. */
      }
    }
    this.schedule(entry);
    return entry.intent;
  }

  async restore(intents: readonly RetryIntent[]): Promise<void> {
    if (this.closed) throw new Error('RETRIES_CLOSED');
    const restored = new Map<string, Entry>();
    for (const intent of intents) {
      validIntent(intent);
      if (this.entries.has(intent.retirementId) || restored.has(intent.retirementId))
        throw new Error('DUPLICATE_RETRY_INTENT');
      restored.set(intent.retirementId, this.createEntry(Object.freeze({ ...intent })));
    }
    // A corrupt later record must not activate any earlier record from this batch.
    for (const [id, entry] of restored) this.entries.set(id, entry);
    for (const entry of restored.values()) this.schedule(entry);
    await Promise.all([...this.entries.values()].map((entry) => entry.writes));
  }

  /** An operator explicitly authorizes one more attempt, still through the same budget. */
  async retryNow(
    retirementId: string,
    options: {
      providerWaitConfirmed?: boolean;
      signal?: AbortSignal;
      beforeDispatch?: () => boolean;
    } = {},
  ): Promise<RetryIntent> {
    const { signal, beforeDispatch } = options;
    const allowed = () => {
      try {
        return !signal?.aborted && (!beforeDispatch || beforeDispatch() === true);
      } catch {
        return false;
      }
    };
    const requireAllowed = () => {
      if (!allowed()) throw new Error('OPERATOR_RETRY_CANCELLED');
    };
    const waitWhileActive = async (work: Promise<void>) => {
      if (!signal) return work;
      if (signal.aborted) {
        void work.catch(() => undefined);
        throw new Error('OPERATOR_RETRY_CANCELLED');
      }
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          signal.removeEventListener('abort', cancel);
          reject(new Error('OPERATOR_RETRY_CANCELLED'));
        };
        signal.addEventListener('abort', cancel, { once: true });
        void work.then(
          () => {
            signal.removeEventListener('abort', cancel);
            resolve();
          },
          (error: unknown) => {
            signal.removeEventListener('abort', cancel);
            reject(error);
          },
        );
      });
    };
    requireAllowed();
    if (this.closed) throw new Error('RETRIES_CLOSED');
    const entry = this.entries.get(retirementId);
    if (!entry) throw new Error('RETRY_NOT_FOUND');
    if (entry.sending) throw new Error('RETRY_IN_FLIGHT');
    if (entry.intent.status === 'REVOKED') return entry.intent;
    if (entry.intent.providerWaitUnknown) {
      if (options.providerWaitConfirmed !== true) throw new Error('PROVIDER_WAIT_UNCONFIRMED');
      await waitWhileActive(
        this.write(entry, (current) => ({ ...current, providerWaitUnknown: false }), allowed),
      );
      requireAllowed();
    }
    if (entry.nextAttemptMs !== null && entry.nextAttemptMs > this.options.monotonicNow()) {
      throw new Error('RETRY_NOT_DUE');
    }
    const work = this.attempt(entry, true, allowed);
    this.track(work);
    await waitWhileActive(work);
    // Remote proof remains durable even if the operation expired after dispatch.
    requireAllowed();
    return entry.intent;
  }

  snapshot(): readonly RetryIntent[] {
    return [...this.entries.values()].map((entry) => entry.intent);
  }

  canPruneConfirmed(roots: ReadonlySet<string>): boolean {
    return (
      !this.closed &&
      !this.failed &&
      [...this.entries.values()].every(
        (entry) =>
          !roots.has(entry.intent.reservationId) ||
          (entry.intent.status === 'REVOKED' &&
            !entry.sending &&
            entry.pendingWrites === 0 &&
            entry.retryTimer === undefined &&
            entry.alarmTimer === undefined),
      )
    );
  }

  /** Owner queues and the shared durable compactor coordinate deletion; omission alone never does. */
  pruneConfirmed(roots: ReadonlySet<string>): void {
    if (!this.canPruneConfirmed(roots)) throw new Error('RETENTION_RETRY_BUSY');
    for (const [id, entry] of this.entries) {
      if (roots.has(entry.intent.reservationId)) this.entries.delete(id);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.entries.values()) this.cancelTimers(entry);
    const active = await Promise.allSettled([...this.active]);
    const writes = await Promise.allSettled(
      [...this.entries.values()].map((entry) => entry.writes),
    );
    const failure = [...active, ...writes].find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  private createEntry(intent: RetryIntent): Entry {
    const epochNow = this.options.epochNowMs();
    const monotonicNow = this.options.monotonicNow();
    if (!Number.isSafeInteger(epochNow) || !Number.isFinite(monotonicNow) || monotonicNow < 0) {
      throw new Error('INVALID_RETRY_CLOCK');
    }
    if (intent.firstRetireEpochMs > epochNow) throw new Error('INVALID_RETRY_CLOCK');
    return {
      intent: Object.freeze({ ...intent }),
      deadlineMs: monotonicNow + Math.max(0, 10_000 - (epochNow - intent.firstRetireEpochMs)),
      nextAttemptMs:
        intent.nextAttemptEpochMs === null
          ? null
          : monotonicNow + Math.max(0, intent.nextAttemptEpochMs - epochNow),
      retryTimer: undefined,
      alarmTimer: undefined,
      sending: false,
      pendingWrites: 0,
      writes: Promise.resolve(),
    };
  }

  private schedule(entry: Entry): void {
    this.cancelTimers(entry);
    if (this.closed) return;
    if (entry.intent.status === 'UNRESOLVED') {
      if (!entry.intent.alarmed) this.track(this.markUnresolved(entry));
      return;
    }
    if (entry.intent.status !== 'REVOKING') return;
    const remaining = entry.deadlineMs - this.options.monotonicNow();
    if (remaining <= 0) {
      this.track(this.markUnresolved(entry));
      return;
    }
    entry.alarmTimer = this.setTimer(() => {
      entry.alarmTimer = undefined;
      this.track(this.alarmWhenDue(entry));
    }, Math.ceil(remaining));
    if (
      entry.sending ||
      entry.intent.attempt >= DELAYS.length ||
      entry.intent.nextAttemptEpochMs === null
    )
      return;
    const delay = Math.max(
      0,
      (entry.nextAttemptMs ?? this.options.monotonicNow()) - this.options.monotonicNow(),
    );
    if (delay >= remaining) return;
    entry.retryTimer = this.setTimer(() => {
      entry.retryTimer = undefined;
      this.track(this.attempt(entry, false));
    }, Math.ceil(delay));
  }

  private async alarmWhenDue(entry: Entry): Promise<void> {
    if (this.closed || entry.intent.status !== 'REVOKING') return;
    if (this.options.monotonicNow() < entry.deadlineMs) {
      this.schedule(entry);
      return;
    }
    await this.markUnresolved(entry);
  }

  private async attempt(
    entry: Entry,
    operator: boolean,
    operatorAllowed: () => boolean = () => true,
  ): Promise<void> {
    if (operator && !operatorAllowed()) return;
    if (entry.sending || this.closed || entry.intent.status === 'REVOKED') return;
    if (!operator && (entry.intent.status !== 'REVOKING' || entry.intent.attempt >= DELAYS.length))
      return;
    if (!operator) {
      const now = this.options.monotonicNow();
      if (now >= entry.deadlineMs) {
        await this.markUnresolved(entry);
        return;
      }
      if (entry.nextAttemptMs !== null && now < entry.nextAttemptMs) {
        this.schedule(entry);
        return;
      }
    }
    if (!this.options.isTerminal(entry.intent)) {
      await this.markUnresolved(entry);
      return;
    }
    entry.sending = true;
    if (entry.retryTimer !== undefined) this.clearTimer(entry.retryTimer);
    entry.retryTimer = undefined;
    try {
      await this.write(
        entry,
        (current) => ({
          ...current,
          attempt: current.attempt + 1,
          lastAttemptEpochMs: this.options.epochNowMs(),
          nextAttemptEpochMs: null,
        }),
        operator ? operatorAllowed : undefined,
      );
      if (entry.intent.nextAttemptEpochMs === null) entry.nextAttemptMs = null;
      if (operator && !operatorAllowed()) return;
      // Disk IO may outlive shutdown, the target deadline, or a terminal-state change.
      if (this.closed) return;
      if (
        (!operator &&
          (entry.intent.status !== 'REVOKING' ||
            this.options.monotonicNow() >= entry.deadlineMs)) ||
        !this.options.isTerminal(entry.intent)
      ) {
        await this.markUnresolved(entry);
        return;
      }
      let response: RetryAttemptResult;
      try {
        response = await this.options.send(entry.intent, {
          beforeDispatch: () => {
            if (operator && !operatorAllowed()) throw new Error('OPERATOR_RETRY_CANCELLED');
            if (this.closed) throw new Error('RETRIES_CLOSED');
            if (!this.options.isTerminal(entry.intent)) throw new Error('RETRY_NOT_TERMINAL');
            if (
              !operator &&
              (entry.intent.status !== 'REVOKING' ||
                this.options.monotonicNow() >= entry.deadlineMs)
            )
              throw new Error('RETRY_DEADLINE_EXCEEDED');
          },
        });
      } catch {
        response = { status: 'retry' };
      }
      if (response.status === 'confirmed') {
        await this.write(entry, (current) => ({
          ...current,
          status: 'REVOKED',
          nextAttemptEpochMs: null,
        }));
        this.cancelTimers(entry);
        await this.options.onConfirmed(entry.intent);
        return;
      }
      if (
        response.status === 'blocked' ||
        (response.status === 'retry' &&
          response.retryAfterMs !== undefined &&
          (!Number.isFinite(response.retryAfterMs) || response.retryAfterMs < 0))
      ) {
        await this.write(entry, (current) => ({
          ...current,
          status: 'UNRESOLVED',
          providerWaitUnknown: true,
          nextAttemptEpochMs: null,
        }));
        await this.markUnresolved(entry);
        return;
      }
      const delay = DELAYS[entry.intent.attempt];
      const retryAfter = response.retryAfterMs ?? 0;
      if (!operator && delay !== undefined && entry.intent.status === 'REVOKING') {
        entry.nextAttemptMs = this.options.monotonicNow() + Math.ceil(Math.max(delay, retryAfter));
        await this.write(entry, (current) => ({
          ...current,
          nextAttemptEpochMs: this.options.epochNowMs() + Math.ceil(Math.max(delay, retryAfter)),
        }));
      } else if (retryAfter > 0) {
        entry.nextAttemptMs = this.options.monotonicNow() + Math.ceil(retryAfter);
        await this.write(entry, (current) => ({
          ...current,
          nextAttemptEpochMs: this.options.epochNowMs() + Math.ceil(retryAfter),
        }));
      }
    } finally {
      entry.sending = false;
      this.schedule(entry);
    }
  }

  private async markUnresolved(entry: Entry): Promise<void> {
    if (entry.intent.status === 'REVOKED' || entry.intent.alarmed) return;
    this.cancelTimers(entry);
    let transitioned = false;
    await this.write(entry, (current) => {
      if (current.status === 'REVOKED' || current.alarmed) return current;
      transitioned = true;
      return { ...current, status: 'UNRESOLVED', alarmed: true };
    });
    if (transitioned && entry.intent.status === 'UNRESOLVED') {
      try {
        this.options.onUnresolved(entry.intent);
      } catch {
        // Alarms are notifications. The durable unresolved state remains authoritative.
      }
    }
  }

  private write(
    entry: Entry,
    update: (current: RetryIntent) => RetryIntent,
    beforeWrite?: () => boolean,
  ): Promise<void> {
    entry.pendingWrites++;
    entry.writes = entry.writes
      .then(async () => {
        if (beforeWrite && !beforeWrite()) return;
        const next = Object.freeze(update(entry.intent));
        validIntent(next);
        await this.options.persist(next);
        entry.intent = next;
      })
      .catch((error: unknown) => {
        this.failClosed();
        throw error;
      })
      .finally(() => {
        entry.pendingWrites--;
      });
    return entry.writes;
  }

  private cancelTimers(entry: Entry): void {
    if (entry.retryTimer !== undefined) this.clearTimer(entry.retryTimer);
    if (entry.alarmTimer !== undefined) this.clearTimer(entry.alarmTimer);
    entry.retryTimer = undefined;
    entry.alarmTimer = undefined;
  }

  private track(work: Promise<unknown>): void {
    this.active.add(work);
    void work.then(
      () => this.active.delete(work),
      () => {
        this.active.delete(work);
        this.failClosed();
      },
    );
  }

  private failClosed(): void {
    if (this.failed) return;
    this.failed = true;
    this.closed = true;
    for (const entry of this.entries.values()) this.cancelTimers(entry);
    try {
      this.options.onPersistenceFailure?.();
    } catch {
      /* notification only */
    }
  }
}
