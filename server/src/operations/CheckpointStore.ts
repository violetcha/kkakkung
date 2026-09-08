import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type Checkpoint<T> = Readonly<{ lastSeq: number; state: T }>;
export type CheckpointRead<T> =
  | Readonly<{ integrity: 'ok'; checkpoint: Checkpoint<T> }>
  | Readonly<{ integrity: 'missing' | 'corrupt'; checkpoint: null }>;

export function checksum(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)]),
      );
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function strictObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_SCHEMA');
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key)) ||
    required.some((key) => !Object.hasOwn(object, key) || object[key] === undefined)
  )
    throw new Error('INVALID_SCHEMA');
  return object;
}

export function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(value);
}

export function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Only basenames under the injected persistent volume are accepted. */
export function operationPath(opsDataDir: string, fileName: string): string {
  if (
    !path.isAbsolute(opsDataDir) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fileName) ||
    fileName === '.' ||
    fileName === '..'
  )
    throw new Error('INVALID_OPERATION_PATH');
  return path.join(path.resolve(opsDataDir), fileName);
}

export async function rejectSymlink(filePath: string): Promise<void> {
  try {
    if ((await fs.lstat(filePath)).isSymbolicLink()) throw new Error('UNSAFE_OPERATION_PATH');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function syncDirectory(directory: string): Promise<void> {
  // Windows does not expose fsync of directory handles through Node. File sync +
  // same-volume rename still apply; the deployment platform must verify durability.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** The owning journal lease must guard this store in production. */
export class CheckpointStore<T> {
  readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();
  private failed = false;

  constructor(
    private readonly options: {
      opsDataDir: string;
      fileName: string;
      validate: (value: unknown) => T;
      isWritable?: () => boolean;
    },
  ) {
    this.filePath = operationPath(options.opsDataDir, options.fileName);
  }

  get writable(): boolean {
    return !this.failed && (this.options.isWritable?.() ?? true);
  }

  async read(): Promise<CheckpointRead<T>> {
    await this.queue;
    try {
      await rejectSymlink(this.filePath);
      const envelope = strictObject(
        JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown,
        ['version', 'lastSeq', 'state', 'checksum'],
      );
      if (
        envelope.version !== 1 ||
        !Number.isSafeInteger(envelope.lastSeq) ||
        (envelope.lastSeq as number) < 0
      )
        throw new Error('INVALID_CHECKPOINT');
      const payload = { version: 1, lastSeq: envelope.lastSeq as number, state: envelope.state };
      if (envelope.checksum !== checksum(payload)) throw new Error('CHECKSUM_MISMATCH');
      return {
        integrity: 'ok',
        checkpoint: { lastSeq: payload.lastSeq, state: this.options.validate(payload.state) },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { integrity: 'missing', checkpoint: null };
      this.failed = true;
      return { integrity: 'corrupt', checkpoint: null };
    }
  }

  write(checkpoint: Checkpoint<T>): Promise<void> {
    const run = this.queue.then(async () => {
      if (!this.writable) throw new Error('CHECKPOINT_NOT_WRITABLE');
      if (!Number.isSafeInteger(checkpoint.lastSeq) || checkpoint.lastSeq < 0)
        throw new Error('INVALID_CHECKPOINT_SEQUENCE');
      // Validate before serializing so unknown fields are rejected, never silently stripped.
      const state = this.options.validate(checkpoint.state);
      const payload = { version: 1, lastSeq: checkpoint.lastSeq, state };
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(this.options.opsDataDir, { recursive: true });
        await rejectSymlink(this.filePath);
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(
            `${JSON.stringify({ ...payload, checksum: checksum(payload) })}\n`,
            'utf8',
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, this.filePath);
        await syncDirectory(this.options.opsDataDir);
      } catch (error) {
        this.failed = true;
        // Keep both the previous checkpoint and incomplete temporary evidence.
        throw error;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
