import type { OperationsCommand, OperationSnapshot } from '../media/types.js';
import { CheckpointStore, checksum, strictObject } from './CheckpointStore.js';

export type OperationsAuditEntry = Readonly<{
  fingerprint: string;
  actorAlias: string;
  snapshot: OperationSnapshot;
}>;

export const OPERATIONS_AUDIT_CODES = [
  'INVALID_COMMAND',
  'REQUEST_ID_CONFLICT',
  'OPERATIONS_NOT_INITIALIZED',
  'OPERATIONS_CLOSED',
  'OPERATION_TIMEOUT',
  'RESUME_NOT_READY',
  'OPERATION_FAILED',
  'OPERATION_UNCONFIRMED',
  'AUDIT_WRITE_FAILED',
  'OPERATIONS_AUDIT_CORRUPT',
  'RECOVERY_UNCONFIRMED',
  'INVALID_OPERATION_CLOCK',
  'UNAUTHORIZED',
] as const;
export type OperationsAuditCode = (typeof OPERATIONS_AUDIT_CODES)[number];
export type OperationsAuditEvent = Readonly<{
  actorAlias: string;
  kind: 'rejected' | 'locked' | 'auth-failed';
  requestId: string | null;
  operationId: string | null;
  action: OperationsCommand['action'] | null;
  resultCode: OperationsAuditCode;
  atEpochMs: number;
}>;
type AuditState = Readonly<{
  entries: readonly OperationsAuditEntry[];
  events: readonly OperationsAuditEvent[];
}>;

export const AUDIT_EVENT_LIMIT = 4096;
export const AUDIT_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EVENT_SAMPLE_INTERVAL_MS = 60_000;
type AuditMetric =
  'operations.audit.events' | 'operations.audit.coalesced' | 'operations.audit.retained';

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const actor = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim() === value &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const actions: readonly unknown[] = ['drain', 'resume', 'checkpoint', 'retry-retirement'];
const safeCode = (value: unknown): value is OperationsAuditCode =>
  (OPERATIONS_AUDIT_CODES as readonly unknown[]).includes(value);
const validTime = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Hash the target for idempotence without writing its raw retirement identity. */
export function fingerprintOperationsCommand(input: OperationsCommand): string {
  const data = strictObject(input, ['requestId', 'action'], ['retirementId']);
  if (
    !identifier(data.requestId) ||
    !actions.includes(data.action) ||
    (data.action === 'retry-retirement'
      ? !identifier(data.retirementId)
      : Object.hasOwn(data, 'retirementId'))
  )
    throw new Error('INVALID_AUDIT_COMMAND');
  return checksum({
    requestId: data.requestId,
    action: data.action,
    retirementId: data.retirementId ?? null,
  });
}

function validateSnapshot(input: unknown): OperationSnapshot {
  const data = strictObject(input, [
    'requestId',
    'operationId',
    'action',
    'status',
    'code',
    'updatedAtEpochMs',
  ]);
  if (
    !identifier(data.requestId) ||
    !identifier(data.operationId) ||
    !actions.includes(data.action) ||
    !(['pending', 'succeeded', 'failed'] as readonly unknown[]).includes(data.status) ||
    !validTime(data.updatedAtEpochMs) ||
    (data.status === 'failed' ? !safeCode(data.code) : data.code !== null)
  )
    throw new Error('INVALID_AUDIT_SNAPSHOT');
  return Object.freeze({ ...data }) as OperationSnapshot;
}

function validateState(input: unknown): AuditState {
  const state = strictObject(input, ['entries', 'events']);
  if (!Array.isArray(state.entries) || !Array.isArray(state.events))
    throw new Error('INVALID_AUDIT_STATE');
  const requests = new Set<string>();
  const operations = new Set<string>();
  const entries = state.entries.map((value: unknown) => {
    const entry = strictObject(value, ['fingerprint', 'actorAlias', 'snapshot']);
    if (
      typeof entry.fingerprint !== 'string' ||
      entry.fingerprint.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
      !actor(entry.actorAlias)
    )
      throw new Error('INVALID_AUDIT_ENTRY');
    const snapshot = validateSnapshot(entry.snapshot);
    if (requests.has(snapshot.requestId) || operations.has(snapshot.operationId))
      throw new Error('DUPLICATE_AUDIT_ENTRY');
    requests.add(snapshot.requestId);
    operations.add(snapshot.operationId);
    return Object.freeze({
      fingerprint: entry.fingerprint,
      actorAlias: entry.actorAlias,
      snapshot,
    });
  });
  const events = state.events.map((value: unknown) => {
    const event = strictObject(value, [
      'actorAlias',
      'kind',
      'requestId',
      'operationId',
      'action',
      'resultCode',
      'atEpochMs',
    ]);
    if (
      !actor(event.actorAlias) ||
      !(['rejected', 'locked', 'auth-failed'] as readonly unknown[]).includes(event.kind) ||
      !safeCode(event.resultCode) ||
      !validTime(event.atEpochMs) ||
      (event.requestId !== null && !identifier(event.requestId)) ||
      (event.operationId !== null && !identifier(event.operationId)) ||
      (event.action !== null && !actions.includes(event.action)) ||
      (event.requestId === null) !== (event.action === null) ||
      (event.requestId === null && event.operationId !== null) ||
      (event.kind === 'auth-failed' &&
        (event.requestId !== null || event.operationId !== null || event.action !== null))
    )
      throw new Error('INVALID_AUDIT_EVENT');
    return Object.freeze({ ...event }) as OperationsAuditEvent;
  });
  return Object.freeze({ entries: Object.freeze(entries), events: Object.freeze(events) });
}

/** Owns no writer lease: the same OperationJournal must remain writable through close(). */
export class OperationsAudit {
  private readonly store: CheckpointStore<AuditState>;
  private state: AuditState = { entries: [], events: [] };
  private sequence = 0;
  private integrity: 'ok' | 'missing' | 'corrupt' = 'missing';
  private restored = false;
  private failed = false;
  private closed = false;
  private closing: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly actorAlias: string;
  // One sample per fixed event kind/code, independent of caller-controlled identifiers.
  private readonly eventSamples = new Map<
    string,
    { at: number; work: Promise<void>; pending: boolean }
  >();

  constructor(
    private readonly options: {
      opsDataDir: string;
      nowEpochMs: () => number;
      actorAlias?: string;
      isWritable: () => boolean;
      /** Explicit evidence that this installation has never accepted an operation. */
      allowMissingHistory?: () => boolean;
      emitMetric?: (name: AuditMetric, value: number) => void;
    },
  ) {
    this.actorAlias = options.actorAlias ?? 'operator';
    if (!actor(this.actorAlias)) throw new Error('INVALID_AUDIT_ACTOR');
    this.store = new CheckpointStore({
      opsDataDir: options.opsDataDir,
      fileName: 'operations-audit.json',
      validate: validateState,
      isWritable: () => options.isWritable?.() === true,
    });
  }

  get writable(): boolean {
    return (
      !this.closed &&
      !this.failed &&
      this.restored &&
      this.integrity === 'ok' &&
      this.store.writable
    );
  }

  async restore(): Promise<{
    integrity: 'ok' | 'missing' | 'corrupt';
    entries: readonly OperationsAuditEntry[];
  }> {
    await this.serialize(async () => {
      if (this.restored) return;
      const result = await this.store.read();
      this.integrity = result.integrity;
      if (result.integrity === 'ok') {
        this.state = result.checkpoint.state;
        this.sequence = result.checkpoint.lastSeq;
        if (this.state.entries.some((entry) => entry.snapshot.status === 'pending')) {
          const now = this.time();
          const entries = this.state.entries.map((entry) =>
            entry.snapshot.status === 'pending'
              ? {
                  ...entry,
                  snapshot: {
                    ...entry.snapshot,
                    status: 'failed' as const,
                    code: 'RECOVERY_UNCONFIRMED',
                    updatedAtEpochMs: Math.max(now, entry.snapshot.updatedAtEpochMs),
                  },
                }
              : entry,
          );
          await this.save({ ...this.state, entries });
        } else if (this.retainedEvents(this.state.events).length !== this.state.events.length) {
          await this.save(this.state);
        }
      } else if (result.integrity === 'missing' && this.options.allowMissingHistory?.() === true) {
        await this.save(this.state);
      }
      this.restored = true;
    });
    return { integrity: this.integrity, entries: structuredClone(this.state.entries) };
  }

  record(command: OperationsCommand, snapshot: OperationSnapshot): Promise<void> {
    const fingerprint = fingerprintOperationsCommand(command);
    const captured = validateSnapshot(snapshot);
    if (command.requestId !== captured.requestId || command.action !== captured.action)
      return Promise.reject(new Error('AUDIT_COMMAND_MISMATCH'));
    return this.serialize(async () => {
      this.assertReady();
      const existing = this.state.entries.find(
        (entry) => entry.snapshot.requestId === captured.requestId,
      );
      if (existing) {
        if (
          existing.fingerprint !== fingerprint ||
          existing.snapshot.operationId !== captured.operationId
        )
          throw new Error('AUDIT_REQUEST_CONFLICT');
        if (checksum(existing.snapshot) === checksum(captured)) return;
        if (
          existing.snapshot.status !== 'pending' ||
          captured.status === 'pending' ||
          captured.updatedAtEpochMs < existing.snapshot.updatedAtEpochMs
        )
          throw new Error('AUDIT_TERMINAL_CONFLICT');
      } else if (captured.status !== 'pending') throw new Error('AUDIT_PENDING_REQUIRED');
      const entry = { fingerprint, actorAlias: this.actorAlias, snapshot: captured };
      await this.save({
        ...this.state,
        entries: existing
          ? this.state.entries.map((value) => (value === existing ? entry : value))
          : [...this.state.entries, entry],
      });
    });
  }

  get(requestId: string): OperationsAuditEntry | null {
    const entry = this.state.entries.find((value) => value.snapshot.requestId === requestId);
    return entry ? structuredClone(entry) : null;
  }

  /** Failed auth and invalid commands never copy attacker-supplied identifiers into storage. */
  recordEvent(input: {
    kind: OperationsAuditEvent['kind'];
    code: OperationsAuditCode;
    command?: OperationsCommand;
    operationId?: string;
  }): Promise<void> {
    if (this.closed) return Promise.reject(new Error('OPERATIONS_CLOSED'));
    const value = strictObject(input, ['kind', 'code'], ['command', 'operationId']);
    if (
      !(['rejected', 'locked', 'auth-failed'] as readonly unknown[]).includes(value.kind) ||
      !safeCode(value.code)
    )
      return Promise.reject(new Error('INVALID_AUDIT_EVENT'));
    let requestId: string | null = null;
    let action: OperationsCommand['action'] | null = null;
    if (value.kind !== 'auth-failed' && value.command) {
      try {
        fingerprintOperationsCommand(value.command as OperationsCommand);
        requestId = (value.command as OperationsCommand).requestId;
        action = (value.command as OperationsCommand).action;
      } catch {
        /* Untrusted invalid input contributes no content to the audit event. */
      }
    }
    const event: OperationsAuditEvent = {
      actorAlias: this.actorAlias,
      kind: value.kind as OperationsAuditEvent['kind'],
      requestId,
      action,
      operationId: requestId !== null && identifier(value.operationId) ? value.operationId : null,
      resultCode: value.code,
      atEpochMs: this.time(),
    };
    if (!this.writable) return Promise.reject(new Error('AUDIT_NOT_READY'));
    this.metric('operations.audit.events', 1);
    const key = `${event.kind}:${event.resultCode}`;
    const previous = this.eventSamples.get(key);
    if (
      previous &&
      (previous.pending ||
        (event.atEpochMs >= previous.at &&
          event.atEpochMs - previous.at < EVENT_SAMPLE_INTERVAL_MS))
    ) {
      this.metric('operations.audit.coalesced', 1);
      return previous.work;
    }
    const work = this.serialize(async () => {
      this.assertReady();
      await this.save({ ...this.state, events: [...this.state.events, event] });
    });
    const sample = { at: event.atEpochMs, work, pending: true };
    this.eventSamples.set(key, sample);
    void work
      .finally(() => {
        sample.pending = false;
      })
      .catch(() => undefined);
    return work;
  }

  /** Only compensate a durable success that the controller has never exposed or applied. */
  invalidateUnpublishedSuccess(
    command: OperationsCommand,
    snapshot: OperationSnapshot,
  ): Promise<void> {
    const fingerprint = fingerprintOperationsCommand(command);
    const captured = validateSnapshot(snapshot);
    const commandRequestId = command.requestId;
    const commandAction = command.action;
    if (
      captured.status !== 'failed' ||
      ![
        'OPERATION_TIMEOUT',
        'OPERATIONS_CLOSED',
        'RESUME_NOT_READY',
        'INVALID_OPERATION_CLOCK',
        'AUDIT_WRITE_FAILED',
        'OPERATION_UNCONFIRMED',
      ].includes(captured.code ?? '')
    )
      return Promise.reject(new Error('INVALID_AUDIT_COMPENSATION'));
    return this.serialize(async () => {
      this.assertReady();
      const existing = this.state.entries.find(
        (entry) => entry.snapshot.requestId === captured.requestId,
      );
      if (
        !existing ||
        existing.fingerprint !== fingerprint ||
        existing.snapshot.operationId !== captured.operationId ||
        captured.action !== commandAction ||
        captured.requestId !== commandRequestId
      )
        throw new Error('AUDIT_REQUEST_CONFLICT');
      if (checksum(existing.snapshot) === checksum(captured)) return;
      if (
        existing.snapshot.status !== 'succeeded' ||
        captured.updatedAtEpochMs < existing.snapshot.updatedAtEpochMs
      )
        throw new Error('AUDIT_TERMINAL_CONFLICT');
      await this.save({
        ...this.state,
        entries: this.state.entries.map((entry) =>
          entry === existing ? { ...entry, snapshot: captured } : entry,
        ),
      });
    });
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.closing = this.queue.then(() => this.store.close());
    }
    return this.closing;
  }

  private assertReady(): void {
    // Accepted writes may drain after close seals admission to this queue.
    if (!this.restored || this.failed || this.integrity !== 'ok')
      throw new Error('AUDIT_NOT_READY');
  }

  private time(): number {
    const now = this.options.nowEpochMs();
    if (!validTime(now)) throw new Error('INVALID_OPERATION_CLOCK');
    return now;
  }

  private async save(state: AuditState): Promise<void> {
    const captured = validateState({ ...state, events: this.retainedEvents(state.events) });
    try {
      await this.store.write({ lastSeq: this.sequence + 1, state: captured });
      this.state = captured;
      this.sequence++;
      this.integrity = 'ok';
      this.metric('operations.audit.retained', captured.events.length);
    } catch {
      this.failed = true;
      throw new Error('AUDIT_WRITE_FAILED');
    }
  }

  private retainedEvents(events: readonly OperationsAuditEvent[]): readonly OperationsAuditEvent[] {
    const now = this.time();
    return events
      .filter((event) => now < event.atEpochMs || now - event.atEpochMs <= AUDIT_EVENT_MAX_AGE_MS)
      .slice(-AUDIT_EVENT_LIMIT);
  }

  private metric(name: AuditMetric, value: number): void {
    try {
      this.options.emitMetric?.(name, value);
    } catch {
      /* Observer only. */
    }
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(new Error('OPERATIONS_CLOSED'));
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
