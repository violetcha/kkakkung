import {
  CheckpointStore,
  strictObject,
  type Checkpoint,
  type CheckpointRead,
} from './CheckpointStore.js';
import { validateRetryIntent, type RetryIntent } from './RevocationRetries.js';

type RetryState = readonly RetryIntent[];

export type SharedRetryCheckpointOptions = Readonly<{
  opsDataDir: string;
  fileName?: string;
  /** The single journal lease remains held until this store and its writers have closed. */
  isWritable: () => boolean;
}>;

function validateState(value: unknown): RetryState {
  if (!Array.isArray(value)) throw new Error('INVALID_RETRY_CHECKPOINT');
  const intents = value.map(validateRetryIntent);
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const intent of intents) {
    if (ids.has(intent.retirementId) || identities.has(intent.identity))
      throw new Error('RETRY_CHECKPOINT_IDENTITY_CONFLICT');
    ids.add(intent.retirementId);
    identities.add(intent.identity);
  }
  return Object.freeze(intents);
}

function capture(value: Checkpoint<RetryState>): Checkpoint<RetryState> {
  strictObject(value, ['lastSeq', 'state']);
  if (!Number.isSafeInteger(value.lastSeq) || value.lastSeq < 0)
    throw new Error('INVALID_CHECKPOINT_SEQUENCE');
  return Object.freeze({ lastSeq: value.lastSeq, state: validateState(value.state) });
}

function assertSuccessor(previous: RetryIntent, incoming: RetryIntent): void {
  if (
    previous.identity !== incoming.identity ||
    previous.reservationId !== incoming.reservationId ||
    previous.generation !== incoming.generation ||
    previous.firstRetireEpochMs !== incoming.firstRetireEpochMs
  )
    throw new Error('RETRY_CHECKPOINT_IDENTITY_CONFLICT');
  if (
    incoming.attempt < previous.attempt ||
    (previous.lastAttemptEpochMs !== null &&
      (incoming.lastAttemptEpochMs === null ||
        incoming.lastAttemptEpochMs < previous.lastAttemptEpochMs)) ||
    (previous.status === 'REVOKED' && incoming.status !== 'REVOKED')
  )
    throw new Error('RETRY_CHECKPOINT_REGRESSION');
}

/**
 * One checkpoint for E-13's previous-process retries and E-11's current-process retries.
 * Each engine owns disjoint retirement identities and submits its complete local snapshot.
 * Omission never deletes the other engine's evidence. Retirement compaction needs a separate,
 * explicitly coordinated operation; it cannot be expressed through these snapshot writes.
 */
export class SharedRetryCheckpoint extends CheckpointStore<RetryState> {
  private mergeQueue: Promise<void> = Promise.resolve();
  private mergeFailed = false;
  private sealed = false;
  private mergeClosing: Promise<void> | null = null;
  private loaded = false;
  private current: Checkpoint<RetryState> | null = null;

  constructor(options: SharedRetryCheckpointOptions) {
    super({
      opsDataDir: options.opsDataDir,
      fileName: options.fileName ?? 'revocation-checkpoint.json',
      validate: validateState,
      isWritable: options.isWritable,
    });
  }

  override get writable(): boolean {
    return !this.sealed && !this.mergeFailed && super.writable;
  }

  override read(): Promise<CheckpointRead<RetryState>> {
    if (this.sealed) return (this.mergeClosing ?? this.mergeQueue).then(() => this.readCurrent());
    const read = this.mergeQueue.then(() => this.readCurrent());
    this.mergeQueue = read.then(
      () => undefined,
      () => {
        this.mergeFailed = true;
      },
    );
    return read;
  }

  override write(checkpoint: Checkpoint<RetryState>): Promise<void> {
    if (this.sealed || this.mergeFailed)
      return Promise.reject(new Error('CHECKPOINT_NOT_WRITABLE'));
    let incoming: Checkpoint<RetryState>;
    try {
      // Capture before the shared queue, not when a caller's mutable object eventually runs.
      incoming = capture(checkpoint);
    } catch (error) {
      this.mergeFailed = true;
      return Promise.reject(error);
    }
    const work = this.mergeQueue.then(async () => {
      // close seals new submissions, but already accepted writes retain their journal lease.
      if (this.mergeFailed || !super.writable) throw new Error('CHECKPOINT_NOT_WRITABLE');
      if (!this.loaded) {
        const restored = await this.readCurrent();
        if (restored.integrity === 'corrupt') throw new Error('RETRY_CHECKPOINT_CORRUPT');
      }
      const next = new Map(this.current?.state.map((intent) => [intent.retirementId, intent]));
      for (const intent of incoming.state) {
        const previous = next.get(intent.retirementId);
        if (previous) assertSuccessor(previous, intent);
        next.set(intent.retirementId, intent);
      }
      const merged: Checkpoint<RetryState> = {
        lastSeq: Math.max(this.current?.lastSeq ?? 0, incoming.lastSeq),
        state: validateState([...next.values()]),
      };
      await super.write(merged);
      this.current = merged;
      this.loaded = true;
    });
    const result = work.catch((error: unknown) => {
      this.mergeFailed = true;
      throw error;
    });
    this.mergeQueue = result.catch(() => undefined);
    return result;
  }

  override close(): Promise<void> {
    if (!this.mergeClosing) {
      this.sealed = true;
      this.mergeClosing = this.mergeQueue.then(() => super.close());
    }
    return this.mergeClosing;
  }

  private async readCurrent(): Promise<CheckpointRead<RetryState>> {
    if (this.mergeFailed) return { integrity: 'corrupt', checkpoint: null };
    const result = await super.read();
    if (result.integrity === 'corrupt') {
      this.mergeFailed = true;
      return result;
    }
    const checkpoint = result.integrity === 'ok' ? capture(result.checkpoint) : null;
    if (this.loaded && JSON.stringify(checkpoint) !== JSON.stringify(this.current)) {
      // Another writer, deletion or an uncoordinated compactor is not a new trusted snapshot.
      this.mergeFailed = true;
      return { integrity: 'corrupt', checkpoint: null };
    }
    this.current = checkpoint;
    this.loaded = true;
    return checkpoint === null
      ? { integrity: 'missing', checkpoint: null }
      : { integrity: 'ok', checkpoint: structuredClone(checkpoint) };
  }
}
