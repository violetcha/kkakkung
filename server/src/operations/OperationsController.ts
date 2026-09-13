import { randomUUID } from 'node:crypto';
import type {
  OperationsCommand,
  OperationsPort,
  OperationsStatus,
  OperationSnapshot,
  OperationSubmission,
} from '../media/types.js';
import {
  OperationsAudit,
  fingerprintOperationsCommand,
  type OperationsAuditCode,
} from './OperationsAudit.js';

export const isOperationsRequestId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

/** Parse a JSON object without retaining caller-owned fields or accepting accessor properties. */
export function parseOperationsCommand(input: unknown): OperationsCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('INVALID_COMMAND');
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) throw new Error('INVALID_COMMAND');
  const fields = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== 'string' || !fields[key]?.enumerable || !('value' in fields[key]),
    )
  )
    throw new Error('INVALID_COMMAND');
  const requestId: unknown = fields.requestId?.value;
  const action: unknown = fields.action?.value;
  if (!isOperationsRequestId(requestId)) throw new Error('INVALID_COMMAND');
  if (action === 'retry-retirement') {
    const retirementId: unknown = fields.retirementId?.value;
    if (
      !isOperationsRequestId(retirementId) ||
      Object.keys(fields).some((key) => !['requestId', 'action', 'retirementId'].includes(key))
    )
      throw new Error('INVALID_COMMAND');
    return Object.freeze({ requestId, action, retirementId });
  }
  if (
    (action !== 'drain' && action !== 'resume' && action !== 'checkpoint') ||
    Object.keys(fields).some((key) => !['requestId', 'action'].includes(key))
  )
    throw new Error('INVALID_COMMAND');
  return Object.freeze({ requestId, action });
}

export const validateOperationsCommand = parseOperationsCommand;

export type OperationsControllerOptions = Readonly<{
  nowEpochMs: () => number;
  monotonicNow: () => number;
  timeoutMs: number;
  /** Internal override for bounded recovery only; never read a deadline from HTTP input. */
  timeoutForCommand?: (command: OperationsCommand) => number | undefined;
  setAdmission: (state: OperationsStatus['admission']) => void;
  getStatus: () => OperationsStatus;
  canResume: () => boolean;
  canComplete?: (command: OperationsCommand) => boolean;
  /** Check beforeDispatch again immediately before each side effect, including after awaits. */
  run: (
    command: OperationsCommand,
    signal: AbortSignal,
    beforeDispatch: () => boolean,
  ) => Promise<void>;
  auditStore: OperationsAudit;
  audit?: (snapshot: OperationSnapshot) => void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}>;

type FailureCode =
  'OPERATION_TIMEOUT' | 'OPERATIONS_CLOSED' | 'INVALID_OPERATION_CLOCK' | 'AUDIT_WRITE_FAILED';
type Entry = { fingerprint: string; snapshot: OperationSnapshot };
type Job = {
  entry: Entry;
  pending: OperationSnapshot;
  command: OperationsCommand;
  abort: AbortController;
  deadline: number;
  timeout: ReturnType<typeof setTimeout> | null;
  stopReason: FailureCode | null;
  admissionRevision: number;
  settled: boolean;
};

const snapshot = (value: OperationSnapshot): OperationSnapshot => ({
  requestId: value.requestId,
  operationId: value.operationId,
  action: value.action,
  status: value.status,
  code: value.code,
  updatedAtEpochMs: value.updatedAtEpochMs,
});

/** Durable, serialized command execution. HTTP authentication/response assembly belongs to B. */
export class OperationsController implements OperationsPort {
  private readonly entries = new Map<string, Entry>();
  private readonly jobs = new Set<Job>();
  private readonly deferredAudit = new Set<Promise<unknown>>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private faulted = false;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private admissionRevision = 0;
  private closing: Promise<void> | null = null;
  private lastMonotonic = 0;
  private lastEpochMs = 0;

  constructor(private readonly deps: OperationsControllerOptions) {
    if (!Number.isSafeInteger(deps.timeoutMs) || deps.timeoutMs <= 0)
      throw new Error('INVALID_OPERATION_TIMEOUT');
    if (!deps.auditStore) throw new Error('OPERATIONS_AUDIT_REQUIRED');
    this.readMonotonic();
    this.timestamp();
  }

  initializeAudit(): Promise<void> {
    this.initialization ??= this.restoreAudit();
    return this.initialization;
  }

  submit(raw: OperationsCommand): OperationSubmission {
    let command: OperationsCommand;
    try {
      command = parseOperationsCommand(raw);
    } catch {
      this.event('rejected', 'INVALID_COMMAND');
      throw new Error('INVALID_COMMAND');
    }
    if (!this.initialized) throw new Error('OPERATIONS_NOT_INITIALIZED');
    const fingerprint = fingerprintOperationsCommand(command);
    const existing = this.entries.get(command.requestId);
    if (existing) {
      this.refreshEntry(existing);
      if (existing.fingerprint === fingerprint)
        return { status: 'accepted', snapshot: snapshot(existing.snapshot) };
      this.event('rejected', 'REQUEST_ID_CONFLICT', command, existing.snapshot.operationId);
      return { status: 'conflict', code: 'REQUEST_ID_CONFLICT' };
    }
    if (this.closed) throw new Error('OPERATIONS_CLOSED');
    if (this.faulted) throw new Error('AUDIT_WRITE_FAILED');
    const override = this.deps.timeoutForCommand?.(command);
    if (
      override !== undefined &&
      (!Number.isSafeInteger(override) || override <= 0 || override > 180_000)
    )
      throw new Error('INVALID_OPERATION_TIMEOUT');
    const timeoutMs = override ?? this.deps.timeoutMs;
    let now: number;
    let updatedAtEpochMs: number;
    try {
      now = this.readMonotonic();
      updatedAtEpochMs = this.timestamp();
      if (now + timeoutMs > Number.MAX_SAFE_INTEGER) throw new Error('INVALID_OPERATION_CLOCK');
    } catch {
      this.admissionRevision++;
      this.deps.setAdmission('LOCKED');
      this.event('locked', 'INVALID_OPERATION_CLOCK', command);
      throw new Error('INVALID_OPERATION_CLOCK');
    }
    if (command.action === 'drain') {
      this.admissionRevision++;
      this.drainAdmission();
    }
    const pending: OperationSnapshot = {
      requestId: command.requestId,
      operationId: randomUUID(),
      action: command.action,
      status: 'pending',
      code: null,
      updatedAtEpochMs,
    };
    const entry: Entry = { fingerprint, snapshot: pending };
    const job: Job = {
      entry,
      pending,
      command,
      abort: new AbortController(),
      deadline: now + timeoutMs,
      timeout: null,
      stopReason: null,
      admissionRevision: this.admissionRevision,
      settled: false,
    };
    this.entries.set(command.requestId, entry);
    this.jobs.add(job);
    this.scheduleTimeout(job);
    this.queue = this.queue.then(() => this.execute(job)).catch(() => this.auditFailed(job));
    return { status: 'accepted', snapshot: snapshot(pending) };
  }

  getSnapshot(requestId: string): OperationSnapshot | null {
    const entry = this.entries.get(requestId);
    if (entry) this.refreshEntry(entry);
    return entry ? snapshot(entry.snapshot) : null;
  }

  private refreshEntry(entry: Entry): void {
    if (entry.snapshot.status === 'pending')
      for (const job of this.jobs) if (job.entry === entry) this.current(job);
  }

  getStatus(): OperationsStatus {
    try {
      return this.readStatus();
    } catch {
      return this.unconfirmedStatus();
    }
  }

  private unconfirmedStatus(): OperationsStatus {
    return {
      admission: 'LOCKED',
      readiness: 'LOCKED',
      unresolvedCount: 0,
      remainingMinutes: null,
      remainingBytes: null,
      checkedAtEpochMs: null,
    };
  }

  private readStatus(): OperationsStatus {
    const value = this.deps.getStatus();
    const count = (item: unknown): item is number =>
      typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
    const amount = (item: unknown): item is number | null =>
      item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0);
    if (
      !value ||
      (value.operatingMode !== undefined &&
        !['attested', 'continuous'].includes(value.operatingMode)) ||
      !['OPEN', 'DRAINING', 'LOCKED'].includes(value.admission) ||
      !['READY', 'RECOVERING', 'LOCKED'].includes(value.readiness) ||
      !count(value.unresolvedCount) ||
      !amount(value.remainingMinutes) ||
      !amount(value.remainingBytes) ||
      !(value.checkedAtEpochMs === null || count(value.checkedAtEpochMs))
    )
      return this.unconfirmedStatus();
    return {
      admission: this.faulted
        ? 'LOCKED'
        : (!this.initialized || this.closed) && value.admission === 'OPEN'
          ? 'DRAINING'
          : value.admission,
      readiness:
        this.faulted || this.closed
          ? 'LOCKED'
          : !this.initialized && value.readiness === 'READY'
            ? 'RECOVERING'
            : value.readiness,
      unresolvedCount: value.unresolvedCount,
      remainingMinutes: value.remainingMinutes,
      remainingBytes: value.remainingBytes,
      checkedAtEpochMs: value.checkedAtEpochMs,
      ...(value.operatingMode ? { operatingMode: value.operatingMode } : {}),
    };
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.admissionRevision++;
    this.drainAdmission();
    for (const job of this.jobs) this.stop(job, 'OPERATIONS_CLOSED');
    this.closing = (async () => {
      await Promise.allSettled([this.initialization, this.queue]);
      // Deferred writes may enqueue compensation writes while they settle.
      while (this.deferredAudit.size > 0) await Promise.allSettled([...this.deferredAudit]);
      await this.deps.auditStore.close();
    })();
    return this.closing;
  }

  private async restoreAudit(): Promise<void> {
    if (this.closed) throw new Error('OPERATIONS_CLOSED');
    this.drainAdmission();
    try {
      const restored = await this.deps.auditStore.restore();
      if (restored.integrity !== 'ok') throw new Error('OPERATIONS_AUDIT_CORRUPT');
      if (this.closed) throw new Error('OPERATIONS_CLOSED');
      for (const entry of restored.entries) {
        this.entries.set(entry.snapshot.requestId, {
          fingerprint: entry.fingerprint,
          snapshot: snapshot(entry.snapshot),
        });
        this.lastEpochMs = Math.max(this.lastEpochMs, entry.snapshot.updatedAtEpochMs);
      }
      this.initialized = true;
    } catch {
      this.faulted = true;
      this.deps.setAdmission('LOCKED');
      throw new Error(this.closed ? 'OPERATIONS_CLOSED' : 'OPERATIONS_AUDIT_CORRUPT');
    }
  }

  private timestamp(): number {
    const value = this.deps.nowEpochMs();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_OPERATION_CLOCK');
    this.lastEpochMs = Math.max(this.lastEpochMs, value);
    return this.lastEpochMs;
  }

  private readMonotonic(): number {
    const value = this.deps.monotonicNow();
    if (!Number.isFinite(value) || value < this.lastMonotonic || value > Number.MAX_SAFE_INTEGER)
      throw new Error('INVALID_OPERATION_CLOCK');
    this.lastMonotonic = value;
    return value;
  }

  private failure(job: Job, code: string): OperationSnapshot {
    let updatedAtEpochMs = this.lastEpochMs;
    try {
      updatedAtEpochMs = this.timestamp();
    } catch {
      this.deps.setAdmission('LOCKED');
    }
    return { ...snapshot(job.pending), status: 'failed', code, updatedAtEpochMs };
  }

  private drainAdmission(): void {
    if (this.getStatus().admission !== 'LOCKED') this.deps.setAdmission('DRAINING');
  }

  private scheduleTimeout(job: Job): void {
    if (!this.current(job)) return;
    const remaining = Math.max(1, Math.ceil(job.deadline - this.lastMonotonic));
    job.timeout = (this.deps.setTimer ?? setTimeout)(
      () => {
        job.timeout = null;
        if (this.current(job)) this.scheduleTimeout(job);
      },
      Math.min(remaining, 2_147_483_647),
    );
    job.timeout.unref?.();
  }

  private clearTimeout(job: Job): void {
    if (job.timeout !== null) (this.deps.clearTimer ?? clearTimeout)(job.timeout);
    job.timeout = null;
  }

  private current(job: Job): boolean {
    if (job.settled || job.stopReason) return false;
    if (this.closed || this.faulted) {
      this.stop(job, this.closed ? 'OPERATIONS_CLOSED' : 'AUDIT_WRITE_FAILED');
      return false;
    }
    try {
      if (this.readMonotonic() >= job.deadline) {
        this.stop(job, 'OPERATION_TIMEOUT');
        return false;
      }
    } catch {
      this.stop(job, 'INVALID_OPERATION_CLOCK');
      return false;
    }
    return true;
  }

  private stop(job: Job, reason: FailureCode): void {
    if (job.settled || job.stopReason) return;
    job.stopReason = reason;
    job.entry.snapshot = this.failure(job, reason);
    this.clearTimeout(job);
    job.abort.abort();
    this.admissionRevision++;
    if (reason === 'AUDIT_WRITE_FAILED' || reason === 'INVALID_OPERATION_CLOCK')
      this.deps.setAdmission('LOCKED');
    else this.drainAdmission();
    if (!this.faulted) this.event('locked', reason, job.command, job.pending.operationId);
  }

  private async race(job: Job, work: Promise<unknown>): Promise<'done' | 'aborted'> {
    if (job.abort.signal.aborted) {
      void work.catch(() => undefined);
      return 'aborted';
    }
    let detach = () => {};
    const aborted = new Promise<'aborted'>((resolve) => {
      const listener = () => resolve('aborted');
      job.abort.signal.addEventListener('abort', listener, { once: true });
      detach = () => job.abort.signal.removeEventListener('abort', listener);
    });
    try {
      return await Promise.race([work.then(() => 'done' as const), aborted]);
    } finally {
      detach();
    }
  }

  private async execute(job: Job): Promise<void> {
    try {
      this.current(job);
      const pendingWrite = this.deps.auditStore.record(job.command, job.pending);
      if ((await this.race(job, pendingWrite)) === 'aborted') {
        this.defer(
          job,
          pendingWrite.then(() => this.deps.auditStore.record(job.command, job.entry.snapshot)),
        );
        return;
      }
      if (!this.current(job)) {
        await this.finish(job, 'failed', job.stopReason ?? 'OPERATIONS_CLOSED');
        return;
      }
      let status: 'succeeded' | 'failed' = 'succeeded';
      let code: string | null = null;
      try {
        if (job.command.action === 'resume' && !this.resumeCurrent(job))
          throw new Error('RESUME_NOT_READY');
        const work = Promise.resolve().then(() => {
          if (!this.current(job)) return;
          return this.deps.run(
            job.command,
            job.abort.signal,
            () =>
              this.current(job) &&
              (job.command.action !== 'resume' || job.admissionRevision === this.admissionRevision),
          );
        });
        if ((await this.race(job, work)) === 'aborted') {
          status = 'failed';
          code = job.stopReason ?? 'OPERATION_TIMEOUT';
        } else if (!this.completionCurrent(job)) {
          status = 'failed';
          code =
            job.stopReason ??
            (job.command.action === 'resume' ? 'RESUME_NOT_READY' : 'OPERATION_UNCONFIRMED');
        }
      } catch {
        status = 'failed';
        code =
          job.stopReason ??
          (job.command.action === 'resume' ? 'RESUME_NOT_READY' : 'OPERATION_FAILED');
      }
      await this.finish(job, status, code);
    } catch {
      this.auditFailed(job);
    } finally {
      this.clearTimeout(job);
      this.jobs.delete(job);
    }
  }

  private resumeCurrent(job: Job): boolean {
    try {
      return (
        this.current(job) &&
        job.admissionRevision === this.admissionRevision &&
        this.deps.canResume()
      );
    } catch {
      return false;
    }
  }

  private completionCurrent(job: Job): boolean {
    try {
      return (
        this.current(job) &&
        (job.command.action !== 'resume' || this.resumeCurrent(job)) &&
        (!this.deps.canComplete || this.deps.canComplete(job.command))
      );
    } catch {
      return false;
    }
  }

  private async finish(
    job: Job,
    status: 'succeeded' | 'failed',
    code: string | null,
  ): Promise<void> {
    if (job.settled) return;
    if (status === 'failed') {
      this.admissionRevision++;
      this.drainAdmission();
    }
    let updatedAtEpochMs: number;
    try {
      updatedAtEpochMs = this.timestamp();
    } catch {
      this.stop(job, 'INVALID_OPERATION_CLOCK');
      status = 'failed';
      code = job.stopReason;
      updatedAtEpochMs = this.lastEpochMs;
    }
    const terminal: OperationSnapshot = {
      ...snapshot(job.pending),
      status,
      code,
      updatedAtEpochMs,
    };
    const write = this.deps.auditStore.record(job.command, terminal);
    if ((await this.race(job, write)) === 'aborted') {
      this.defer(
        job,
        write.then(async () => {
          if (status === 'succeeded')
            await this.deps.auditStore.invalidateUnpublishedSuccess(
              job.command,
              job.entry.snapshot,
            );
        }),
      );
      return;
    }
    if (status === 'succeeded' && !this.completionCurrent(job)) {
      const failed = this.failure(
        job,
        job.stopReason ??
          (job.command.action === 'resume' ? 'RESUME_NOT_READY' : 'OPERATION_UNCONFIRMED'),
      );
      job.entry.snapshot = failed;
      this.admissionRevision++;
      this.drainAdmission();
      const compensation = this.deps.auditStore.invalidateUnpublishedSuccess(job.command, failed);
      if ((await this.race(job, compensation)) === 'aborted') this.defer(job, compensation);
      return;
    }
    // No await between the final deadline/readiness fence, admission change, and published result.
    if (status === 'succeeded' && job.command.action === 'resume') this.deps.setAdmission('OPEN');
    job.entry.snapshot = terminal;
    job.settled = true;
    this.clearTimeout(job);
    try {
      this.deps.audit?.(snapshot(terminal));
    } catch {
      // Observer failure cannot change a durable result.
    }
  }

  private event(
    kind: 'rejected' | 'locked',
    code: OperationsAuditCode,
    command?: OperationsCommand,
    operationId?: string,
  ): void {
    if (!this.initialized || this.closed || this.faulted) return;
    try {
      const work = this.deps.auditStore.recordEvent({ kind, code, command, operationId });
      this.defer(undefined, work);
    } catch {
      this.auditFailed();
    }
  }

  private defer(job: Job | undefined, work: Promise<unknown>): void {
    this.deferredAudit.add(work);
    void work.then(
      () => this.deferredAudit.delete(work),
      () => {
        this.deferredAudit.delete(work);
        this.auditFailed(job);
      },
    );
  }

  private auditFailed(job?: Job): void {
    this.faulted = true;
    this.admissionRevision++;
    this.deps.setAdmission('LOCKED');
    for (const pending of this.jobs) this.stop(pending, 'AUDIT_WRITE_FAILED');
    if (job && !job.settled)
      job.entry.snapshot = this.failure(job, job.stopReason ?? 'AUDIT_WRITE_FAILED');
  }
}
