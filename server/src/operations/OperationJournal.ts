import { freezeSnapshot } from './ImmutableSnapshot.js';
import {
  sameMediaOwnership,
  validateSplitMediaOwnership,
  type SplitMediaOwnership,
} from './SplitMediaOwnership.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import {
  CheckpointStore,
  checksum,
  nonnegative,
  operationPath,
  rejectSymlink,
  safeIdentifier,
  strictObject,
  syncDirectory,
} from './CheckpointStore.js';

export type JournalState = 'PREPARED' | 'REVOKING' | 'REVOKED' | 'UNRESOLVED';
export type JournalRecord = Readonly<{
  state: JournalState;
  namespace: string;
  matchId: string;
  mediaInstanceId: string;
  roomName: string;
  serverEpoch: string;
  identity: string;
  generation: number;
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
  splitOwnership?: SplitMediaOwnership;
  reservationId?: string;
  retirementId?: string;
  requestId?: string;
  atEpochMs?: number;
  attempt?: number;
  firstRetireAtEpochMs?: number;
}>;
export type JournalEntry = Readonly<{
  version: 1;
  seq: number;
  record: JournalRecord;
  checksum: string;
}>;
export type JournalRestore = Readonly<{
  records: readonly JournalEntry[];
  lastSeq: number;
  integrity: 'ok' | 'missing' | 'corrupt' | 'partial';
  writable: boolean;
  unresolved: boolean;
  reason?: 'WRITER_CONFLICT' | 'IO_FAILURE' | 'INTEGRITY_FAILURE';
}>;

type CheckpointBoundary = Readonly<{ lastSeq: number; checkpointChecksum: string }>;
type JournalCheckpointState = Readonly<{
  entries: readonly JournalEntry[];
  previousAnchor: CheckpointBoundary | null;
}>;
type JournalAnchor = Readonly<{
  version: 1;
  kind: 'checkpoint-anchor';
  lastSeq: number;
  checkpointChecksum: string;
  checksum: string;
}>;

function recordKey(record: JournalRecord): string {
  return JSON.stringify([record.namespace, record.roomName, record.identity, record.generation]);
}

function validateEntry(value: unknown): JournalEntry {
  const parsed = strictObject(value, ['version', 'seq', 'record', 'checksum']);
  if (parsed.version !== 1 || !Number.isSafeInteger(parsed.seq) || (parsed.seq as number) < 1)
    throw new Error('INVALID_JOURNAL_ENTRY');
  const payload = {
    version: 1 as const,
    seq: parsed.seq as number,
    record: validateJournalRecord(parsed.record),
  };
  if (parsed.checksum !== checksum(payload)) throw new Error('CHECKSUM_MISMATCH');
  return { ...payload, checksum: parsed.checksum as string };
}

function validateJournalCheckpoint(value: unknown): JournalCheckpointState {
  const parsed = strictObject(value, ['entries', 'previousAnchor']);
  if (!Array.isArray(parsed.entries)) throw new Error('INVALID_JOURNAL_CHECKPOINT');
  const entries = parsed.entries.map(validateEntry);
  const identities = new Set<string>();
  let lastSeq = 0;
  for (const entry of entries) {
    const key = recordKey(entry.record);
    if (identities.has(key) || entry.seq <= lastSeq) throw new Error('DUPLICATE_CHECKPOINT_ENTRY');
    identities.add(key);
    lastSeq = entry.seq;
  }
  let previousAnchor: CheckpointBoundary | null = null;
  if (parsed.previousAnchor !== null) {
    const boundary = strictObject(parsed.previousAnchor, ['lastSeq', 'checkpointChecksum']);
    if (
      !Number.isSafeInteger(boundary.lastSeq) ||
      (boundary.lastSeq as number) < 1 ||
      typeof boundary.checkpointChecksum !== 'string' ||
      !/^[a-f0-9]{64}$/.test(boundary.checkpointChecksum)
    )
      throw new Error('INVALID_PREVIOUS_ANCHOR');
    previousAnchor = {
      lastSeq: boundary.lastSeq as number,
      checkpointChecksum: boundary.checkpointChecksum,
    };
  }
  return { entries, previousAnchor };
}

function validateAnchor(value: unknown): JournalAnchor {
  const parsed = strictObject(value, [
    'version',
    'kind',
    'lastSeq',
    'checkpointChecksum',
    'checksum',
  ]);
  if (
    parsed.version !== 1 ||
    parsed.kind !== 'checkpoint-anchor' ||
    !Number.isSafeInteger(parsed.lastSeq) ||
    (parsed.lastSeq as number) < 1 ||
    typeof parsed.checkpointChecksum !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed.checkpointChecksum)
  )
    throw new Error('INVALID_JOURNAL_ANCHOR');
  const payload = {
    version: 1 as const,
    kind: 'checkpoint-anchor' as const,
    lastSeq: parsed.lastSeq as number,
    checkpointChecksum: parsed.checkpointChecksum,
  };
  if (parsed.checksum !== checksum(payload)) throw new Error('ANCHOR_CHECKSUM_MISMATCH');
  return { ...payload, checksum: parsed.checksum as string };
}

export function validateJournalRecord(value: unknown): JournalRecord {
  const object = strictObject(
    value,
    [
      'state',
      'namespace',
      'matchId',
      'mediaInstanceId',
      'roomName',
      'serverEpoch',
      'identity',
      'generation',
      'issuedAtEpochMs',
      'expiresAtEpochMs',
    ],
    [
      'reservationId',
      'retirementId',
      'requestId',
      'atEpochMs',
      'attempt',
      'firstRetireAtEpochMs',
      'splitOwnership',
    ],
  );
  if (!['PREPARED', 'REVOKING', 'REVOKED', 'UNRESOLVED'].includes(object.state as string))
    throw new Error('INVALID_JOURNAL_STATE');
  for (const key of [
    'namespace',
    'matchId',
    'mediaInstanceId',
    'roomName',
    'serverEpoch',
    'identity',
    'reservationId',
    'retirementId',
    'requestId',
  ]) {
    if (object[key] !== undefined && !safeIdentifier(object[key]))
      throw new Error('INVALID_JOURNAL_IDENTIFIER');
  }
  for (const key of [
    'generation',
    'issuedAtEpochMs',
    'expiresAtEpochMs',
    'atEpochMs',
    'attempt',
    'firstRetireAtEpochMs',
  ]) {
    if (
      object[key] !== undefined &&
      (!nonnegative(object[key]) || !Number.isSafeInteger(object[key]))
    )
      throw new Error('INVALID_JOURNAL_NUMBER');
  }
  if (
    (object.generation as number) < 1 ||
    (object.expiresAtEpochMs as number) < (object.issuedAtEpochMs as number)
  )
    throw new Error('INVALID_JOURNAL_LIFETIME');
  const record = { ...object } as JournalRecord;
  return object.splitOwnership === undefined
    ? record
    : { ...record, splitOwnership: validateSplitMediaOwnership(object.splitOwnership, record) };
}

export class OperationJournal {
  readonly filePath: string;
  private readonly lockPath: string;
  private readonly writerId = randomUUID();
  private readonly checkpoint: CheckpointStore<JournalCheckpointState>;
  private immutableRecords: readonly JournalEntry[] | null = null;
  private readonly latest = new Map<string, JournalEntry>();
  private queue: Promise<void> = Promise.resolve();
  private handle: FileHandle | null = null;
  private lock: FileHandle | null = null;
  private restored: Promise<JournalRestore> | null = null;
  private seq = 0;
  private enabled = false;
  private closed = false;
  private closing = false;
  private lastCompactedSeq = -1;
  private logAnchor: CheckpointBoundary | null = null;

  constructor(private readonly options: { opsDataDir: string; fileName?: string }) {
    this.filePath = operationPath(options.opsDataDir, options.fileName ?? 'media-journal.jsonl');
    this.lockPath = operationPath(options.opsDataDir, 'writer.lock');
    this.checkpoint = new CheckpointStore({
      opsDataDir: options.opsDataDir,
      fileName: `${options.fileName ?? 'media-journal.jsonl'}.checkpoint.json`,
      validate: validateJournalCheckpoint,
      isWritable: () => this.enabled && !this.closed,
    });
  }
  get writable(): boolean {
    return this.enabled && !this.closed && !this.closing;
  }

  /** Latest durable state per generation; restore() is the immutable boot replay. */
  snapshot(): Readonly<{ lastSeq: number; records: readonly JournalEntry[]; writable: boolean }> {
    return {
      lastSeq: this.seq,
      records: structuredClone([...this.latest.values()].sort((a, b) => a.seq - b.seq)),
      writable: this.writable,
    };
  }

  /** Immutable durable records reused until append/replay/compaction changes the data.
   * Writer status and sequence are always read live, including failures and close.
   */
  readSnapshot(): ReturnType<OperationJournal['snapshot']> {
    this.immutableRecords ??= freezeSnapshot(this.snapshot().records);
    return Object.freeze({
      lastSeq: this.seq,
      records: this.immutableRecords,
      writable: this.writable,
    });
  }

  /** Wait for already accepted journal work; a failed or closing writer is never confirmed. */
  async flush(): Promise<void> {
    const accepted = this.queue;
    await this.restored;
    await accepted;
    if (!this.writable) throw new Error('JOURNAL_NOT_WRITABLE');
  }

  restore(options: { afterSeq?: number } = {}): Promise<JournalRestore> {
    if (this.restored) return this.restored;
    this.restored = this.openAndRestore(options.afterSeq ?? 0);
    return this.restored;
  }

  private async openAndRestore(afterSeq: number): Promise<JournalRestore> {
    let integrity: JournalRestore['integrity'] = 'ok';
    const records: JournalEntry[] = [];
    try {
      if (this.closed || !Number.isSafeInteger(afterSeq) || afterSeq < 0)
        throw new Error('INVALID_RESTORE');
      await fs.mkdir(this.options.opsDataDir, { recursive: true });
      await rejectSymlink(this.lockPath);
      try {
        this.lock = await this.acquireWriter();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          return {
            records,
            lastSeq: 0,
            integrity: 'missing',
            writable: false,
            unresolved: true,
            reason: 'WRITER_CONFLICT',
          };
        throw error;
      }
      await this.lock.writeFile(
        JSON.stringify({ version: 1, writerId: this.writerId, pid: process.pid }),
      );
      await this.lock.sync();
      await syncDirectory(this.options.opsDataDir);
      const saved = await this.checkpoint.read();
      const checkpoint = saved.integrity === 'ok' ? saved.checkpoint : null;
      const checkpointSeq = checkpoint?.lastSeq ?? 0;
      if (saved.integrity === 'corrupt') integrity = 'corrupt';
      if (checkpoint) {
        if (
          checkpoint.lastSeq < 1 ||
          checkpoint.state.entries.some((entry) => entry.seq > checkpoint.lastSeq)
        )
          integrity = 'corrupt';
        else {
          this.seq = checkpoint.lastSeq;
          for (const entry of checkpoint.state.entries) {
            this.immutableRecords = null;
            this.latest.set(recordKey(entry.record), structuredClone(entry));
            if (entry.seq > afterSeq) records.push(entry);
          }
        }
      }
      await rejectSymlink(this.filePath);
      let text: string;
      try {
        text = await fs.readFile(this.filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        text = '';
        if (integrity !== 'corrupt') integrity = 'missing';
      }
      if (text.length && !text.endsWith('\n') && integrity !== 'corrupt') integrity = 'partial';
      const lines = text.split('\n');
      if (text.endsWith('\n')) lines.pop();
      else if (text.length) lines.pop(); // Never consider an unterminated record durable.
      let expected = 1;
      let anchor: JournalAnchor | null = null;
      let logLastSeq = 0;
      for (const [index, line] of lines.entries()) {
        if (!line && !text.length) continue;
        try {
          const value = JSON.parse(line) as unknown;
          if (index === 0 && value && typeof value === 'object' && 'kind' in value) {
            anchor = validateAnchor(value);
            const currentBoundary =
              checkpoint &&
              anchor.lastSeq === checkpointSeq &&
              anchor.checkpointChecksum === checksum(checkpoint);
            const priorBoundary =
              checkpoint?.state.previousAnchor &&
              anchor.lastSeq === checkpoint.state.previousAnchor.lastSeq &&
              anchor.checkpointChecksum === checkpoint.state.previousAnchor.checkpointChecksum;
            if (
              !checkpoint ||
              anchor.lastSeq > checkpointSeq ||
              (!currentBoundary && !priorBoundary)
            )
              throw new Error('CHECKPOINT_ANCHOR_MISMATCH');
            this.logAnchor = {
              lastSeq: anchor.lastSeq,
              checkpointChecksum: anchor.checkpointChecksum,
            };
            expected = anchor.lastSeq + 1;
            logLastSeq = anchor.lastSeq;
            continue;
          }
          const entry = validateEntry(value);
          if (entry.seq !== expected) throw new Error('SEQUENCE_GAP');
          if (entry.seq > checkpointSeq) {
            const previous = this.latest.get(recordKey(entry.record));
            if (previous && !sameMediaOwnership(previous.record, entry.record))
              throw new Error('JOURNAL_OWNERSHIP_CHANGED');
            this.immutableRecords = null;
            this.latest.set(recordKey(entry.record), structuredClone(entry));
            if (entry.seq > afterSeq) records.push(entry);
          }
          logLastSeq = entry.seq;
          this.seq = Math.max(this.seq, entry.seq);
          expected++;
        } catch {
          integrity = 'corrupt';
          break;
        }
      }
      // The pre-rotation log must cover the complete checkpoint boundary. The
      // post-rotation log proves the same boundary with its durable anchor.
      if (checkpoint && (integrity === 'missing' || !text.length || logLastSeq < checkpointSeq))
        integrity = 'corrupt';
      if (checkpoint?.state.previousAnchor && !anchor) integrity = 'corrupt';
      if (this.seq < afterSeq) integrity = 'corrupt';
      this.seq = Math.max(this.seq, afterSeq);
      if (integrity === 'partial' || integrity === 'corrupt')
        return {
          records,
          lastSeq: this.seq,
          integrity,
          writable: false,
          unresolved: true,
          reason: 'INTEGRITY_FAILURE',
        };
      if (integrity !== 'missing') {
        this.handle = await fs.open(this.filePath, 'a', 0o600);
        await this.handle.sync();
      }
      this.enabled = true;
      if (anchor?.lastSeq === checkpointSeq && logLastSeq === checkpointSeq)
        this.lastCompactedSeq = checkpointSeq;
      return {
        records,
        lastSeq: this.seq,
        integrity,
        writable: true,
        // Replay filtering must not hide an older unresolved generation. The full
        // latest-state index also keeps identical identities in separate scopes apart.
        unresolved: [...this.latest.values()].some((entry) => entry.record.state !== 'REVOKED'),
      };
    } catch {
      this.enabled = false;
      return {
        records,
        lastSeq: this.seq,
        integrity,
        writable: false,
        unresolved: true,
        reason: 'IO_FAILURE',
      };
    }
  }

  private async acquireWriter(): Promise<FileHandle> {
    // Serialize stale-owner inspection with acquisition. A crash inside this tiny
    // critical section leaves its gate as evidence and requires operator recovery.
    const gatePath = operationPath(this.options.opsDataDir, 'writer-acquire.lock');
    const gate = await fs.open(gatePath, 'wx', 0o600);
    try {
      try {
        return await fs.open(this.lockPath, 'wx', 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let owner: Record<string, unknown>;
        try {
          owner = strictObject(JSON.parse(await fs.readFile(this.lockPath, 'utf8')) as unknown, [
            'version',
            'writerId',
            'pid',
          ]);
          if (
            owner.version !== 1 ||
            !safeIdentifier(owner.writerId) ||
            !Number.isSafeInteger(owner.pid) ||
            (owner.pid as number) <= 0
          )
            throw error;
          try {
            process.kill(owner.pid as number, 0);
            throw error;
          } catch (probeError) {
            if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
        } catch {
          throw error;
        }
        // PID absence on the single-host deployment is evidence of owner death.
        // Preserve the stale owner record instead of deleting it.
        await fs.rename(this.lockPath, `${this.lockPath}.abandoned.${randomUUID()}`);
        return await fs.open(this.lockPath, 'wx', 0o600);
      }
    } finally {
      await gate.close();
      await fs.unlink(gatePath);
    }
  }

  append(input: JournalRecord): Promise<{ seq: number; durable: true }> {
    if (this.closed || this.closing) return Promise.reject(new Error('JOURNAL_NOT_WRITABLE'));
    // Capture a validated immutable copy before the caller can mutate its object.
    let record: JournalRecord;
    try {
      record = validateJournalRecord(input);
    } catch (error) {
      return Promise.reject(error);
    }
    const run = this.queue.then(async () => {
      await this.restored;
      if (!this.enabled || this.closed) throw new Error('JOURNAL_NOT_WRITABLE');
      const previous = this.latest.get(recordKey(record));
      if (previous && !sameMediaOwnership(previous.record, record))
        throw new Error('JOURNAL_OWNERSHIP_CHANGED');
      const payload = { version: 1 as const, seq: this.seq + 1, record };
      try {
        const created = this.handle === null;
        if (!this.handle) this.handle = await fs.open(this.filePath, 'ax', 0o600);
        await this.handle.writeFile(
          `${JSON.stringify({ ...payload, checksum: checksum(payload) })}\n`,
          'utf8',
        );
        await this.handle.sync();
        if (created) await syncDirectory(this.options.opsDataDir);
        this.seq = payload.seq;
        this.immutableRecords = null;
        this.latest.set(recordKey(record), { ...payload, checksum: checksum(payload) });
        return { seq: this.seq, durable: true as const };
      } catch (error) {
        this.enabled = false;
        throw error;
      }
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /**
   * The callback must use verified end/revocation/official-adjustment timestamps
   * with RetentionPolicy.canCompact. Non-REVOKED states are never eligible,
   * regardless of the callback. No log is replaced before the checkpoint is durable.
   */
  compact(
    isEligible: (record: JournalRecord) => boolean,
  ): Promise<{ lastSeq: number; retained: number; removed: number; durable: true }> {
    if (this.closed || this.closing) return Promise.reject(new Error('JOURNAL_NOT_WRITABLE'));
    const run = this.queue.then(async () => {
      await this.restored;
      if (!this.enabled || this.closed || !this.checkpoint.writable)
        throw new Error('JOURNAL_NOT_WRITABLE');
      const entries = [...this.latest.values()].sort((a, b) => a.seq - b.seq);
      const retained = entries.filter(
        (entry) =>
          entry.record.state !== 'REVOKED' ||
          !isEligible(freezeSnapshot(structuredClone(entry.record))),
      );
      const removed = entries.length - retained.length;
      const result = {
        lastSeq: this.seq,
        retained: retained.length,
        removed,
        durable: true as const,
      };
      if (this.seq === 0 || (removed === 0 && this.lastCompactedSeq === this.seq)) return result;
      const snapshot = {
        lastSeq: this.seq,
        state: { entries: retained, previousAnchor: this.logAnchor },
      };
      const anchorPayload = {
        version: 1 as const,
        kind: 'checkpoint-anchor' as const,
        lastSeq: this.seq,
        checkpointChecksum: checksum(snapshot),
      };
      const temporary = `${this.filePath}.${randomUUID()}.rotate.tmp`;
      try {
        await this.checkpoint.write(snapshot);
        // The original log stays intact if temp creation, fsync or rename fails.
        const replacement = await fs.open(temporary, 'wx', 0o600);
        try {
          await replacement.writeFile(
            `${JSON.stringify({ ...anchorPayload, checksum: checksum(anchorPayload) })}\n`,
            'utf8',
          );
          await replacement.sync();
        } finally {
          await replacement.close();
        }
        await this.handle?.close();
        this.handle = null;
        await rejectSymlink(this.filePath);
        await fs.rename(temporary, this.filePath);
        await syncDirectory(this.options.opsDataDir);
        this.handle = await fs.open(this.filePath, 'a', 0o600);
        this.immutableRecords = null;
        this.latest.clear();
        for (const entry of retained)
          this.latest.set(recordKey(entry.record), structuredClone(entry));
        this.lastCompactedSeq = this.seq;
        this.logAnchor = {
          lastSeq: this.seq,
          checkpointChecksum: anchorPayload.checkpointChecksum,
        };
        return result;
      } catch (error) {
        this.enabled = false;
        // Leave all evidence for restore; never truncate or delete damaged input.
        throw error;
      }
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.restored;
    await this.queue;
    if (this.closed) return;
    this.closed = true;
    this.enabled = false;
    await this.handle?.close();
    this.handle = null;
    if (this.lock) {
      await this.lock.close();
      this.lock = null;
      // Delete only our own lease; a stale-owner record remains as recovery evidence.
      const current = JSON.parse(await fs.readFile(this.lockPath, 'utf8')) as { writerId?: string };
      if (current.writerId === this.writerId) await fs.unlink(this.lockPath);
    }
  }
}
