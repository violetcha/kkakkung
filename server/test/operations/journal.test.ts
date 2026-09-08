import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CheckpointStore, checksum, strictObject } from '../../src/operations/CheckpointStore.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import type { JournalRecord } from '../../src/operations/OperationJournal.js';

const directories: string[] = [];
const journals: OperationJournal[] = [];
async function directory() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e-journal-'));
  directories.push(value);
  return value;
}
function create(opsDataDir: string) {
  const journal = new OperationJournal({ opsDataDir });
  journals.push(journal);
  return journal;
}
const record: JournalRecord = {
  state: 'PREPARED',
  namespace: 'qa-e',
  matchId: 'match-1',
  mediaInstanceId: 'media-1',
  roomName: 'qa-e-room',
  serverEpoch: 'epoch-1',
  identity: 'identity-1',
  generation: 1,
  issuedAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const journal of journals.splice(0)) await journal.close();
  for (const target of directories.splice(0)) {
    if (
      !path.resolve(target).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(target).startsWith('kkakkung-e-journal-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('operation journal durability', () => {
  it('serializes appends and replays each record after the checkpoint once', async () => {
    const dir = await directory();
    const first = create(dir);
    expect(await first.restore()).toMatchObject({ integrity: 'missing', writable: true });
    expect(
      await Promise.all([
        first.append(record),
        first.append({ ...record, state: 'REVOKING' }),
        first.append({ ...record, state: 'REVOKED' }),
      ]),
    ).toEqual([
      { seq: 1, durable: true },
      { seq: 2, durable: true },
      { seq: 3, durable: true },
    ]);
    await first.close();
    const restored = await create(dir).restore({ afterSeq: 1 });
    expect(restored.integrity).toBe('ok');
    expect(restored.records.map((r) => r.seq)).toEqual([2, 3]);
  });

  it('rejects unknown fields without writing secrets', async () => {
    const journal = create(await directory());
    await journal.restore();
    await expect(
      journal.append({ ...record, token: 'sensitive-value' } as JournalRecord),
    ).rejects.toThrow('INVALID_SCHEMA');
    await expect(fs.readFile(journal.filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects undefined required fields before a durable record can omit them', async () => {
    const journal = create(await directory());
    await journal.restore();
    for (const key of Object.keys(record))
      await expect(journal.append({ ...record, [key]: undefined })).rejects.toThrow();
    await expect(fs.readFile(journal.filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(journal.append(record)).resolves.toMatchObject({ seq: 1, durable: true });
  });

  it('keeps unresolved earlier generations visible when replay starts after a sequence', async () => {
    const dir = await directory();
    const first = create(dir);
    await first.restore();
    await first.append(record);
    await first.append({ ...record, generation: 2, state: 'REVOKED' });
    await first.close();
    const restored = await create(dir).restore({ afterSeq: 1 });
    expect(restored.records.map((entry) => entry.seq)).toEqual([2]);
    expect(restored).toMatchObject({ integrity: 'ok', writable: true, unresolved: true });
  });

  it('does not resolve issuance before FileHandle.sync finishes', async () => {
    const journal = create(await directory());
    await journal.restore();
    const handle = await fs.open(`${journal.filePath}.prototype-test`, 'a');
    const prototype = Object.getPrototypeOf(handle) as { sync: () => Promise<void> };
    await handle.close();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = vi.spyOn(prototype, 'sync').mockImplementation(() => gate);
    let resolved = false;
    const append = journal.append(record).then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(sync).toHaveBeenCalled());
    expect(resolved).toBe(false);
    release();
    await append;
    expect(resolved).toBe(true);
  });

  it.each(['partial', 'sequence', 'checksum'] as const)(
    'preserves %s corruption and locks issuance',
    async (kind) => {
      const dir = await directory();
      const journal = create(dir);
      await journal.restore();
      await journal.append(record);
      await journal.close();
      const original = await fs.readFile(journal.filePath, 'utf8');
      const payload = { version: 1, seq: kind === 'sequence' ? 4 : 2, record };
      const damaged =
        original +
        (kind === 'partial'
          ? '{"version":1'
          : `${JSON.stringify({ ...payload, checksum: kind === 'checksum' ? 'invalid' : checksum(payload) })}\n`);
      await fs.writeFile(journal.filePath, damaged);
      const next = create(dir);
      expect(await next.restore()).toMatchObject({
        integrity: kind === 'partial' ? 'partial' : 'corrupt',
        writable: false,
        unresolved: true,
      });
      await expect(next.append(record)).rejects.toThrow('JOURNAL_NOT_WRITABLE');
      expect(await fs.readFile(journal.filePath, 'utf8')).toBe(damaged);
    },
  );

  it('rejects the second writer without deleting the first writer lock', async () => {
    const dir = await directory();
    const first = create(dir);
    await first.restore();
    const second = create(dir);
    expect(await second.restore()).toMatchObject({ writable: false, reason: 'WRITER_CONFLICT' });
    await second.close();
    await expect(first.append(record)).resolves.toEqual({ seq: 1, durable: true });
    await expect(fs.stat(path.join(dir, 'writer.lock'))).resolves.toBeDefined();
  });

  it('preserves a missing journal across restarts until an authorized append', async () => {
    const dir = await directory();
    const first = create(dir);
    expect((await first.restore()).integrity).toBe('missing');
    await first.close();
    const second = create(dir);
    expect((await second.restore()).integrity).toBe('missing');
    await expect(fs.stat(first.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers an abandoned single-host writer only after its PID is proven absent', async () => {
    const dir = await directory();
    await fs.writeFile(
      path.join(dir, 'writer.lock'),
      JSON.stringify({ version: 1, writerId: 'previous-writer', pid: 123456 }),
    );
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no process'), { code: 'ESRCH' });
    });
    const journal = create(dir);
    expect((await journal.restore()).writable).toBe(true);
    expect((await fs.readdir(dir)).some((name) => name.startsWith('writer.lock.abandoned.'))).toBe(
      true,
    );
    await expect(journal.append(record)).resolves.toMatchObject({ durable: true });
  });

  it('finishes already queued writes during close and rejects new writes immediately', async () => {
    const journal = create(await directory());
    await journal.restore();
    const accepted = journal.append(record);
    const close = journal.close();
    await expect(journal.append(record)).rejects.toThrow('JOURNAL_NOT_WRITABLE');
    await expect(accepted).resolves.toMatchObject({ durable: true });
    await close;
  });

  it('locks all subsequent appends after ENOSPC and keeps pending evidence', async () => {
    const journal = create(await directory());
    await journal.restore();
    const handle = await fs.open(`${journal.filePath}.prototype-test`, 'a');
    const prototype = Object.getPrototypeOf(handle) as { sync: () => Promise<void> };
    await handle.close();
    vi.spyOn(prototype, 'sync').mockRejectedValue(
      Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
    );
    await expect(journal.append(record)).rejects.toThrow('disk full');
    expect(journal.writable).toBe(false);
    await expect(journal.append(record)).rejects.toThrow('JOURNAL_NOT_WRITABLE');
  });
});

describe('atomic checkpoint replacement', () => {
  function store(dir: string) {
    return new CheckpointStore({
      opsDataDir: dir,
      fileName: 'state.json',
      validate: (value) => {
        const o = strictObject(value, ['count']);
        if (!Number.isSafeInteger(o.count)) throw new Error('BAD_COUNT');
        return { count: o.count as number };
      },
    });
  }
  it('reads only complete synced replacements and validates checksums', async () => {
    const dir = await directory();
    const checkpoint = store(dir);
    await checkpoint.write({ lastSeq: 1, state: { count: 1 } });
    await checkpoint.write({ lastSeq: 2, state: { count: 2 } });
    expect(await checkpoint.read()).toEqual({
      integrity: 'ok',
      checkpoint: { lastSeq: 2, state: { count: 2 } },
    });
    await fs.writeFile(checkpoint.filePath, '{"version":1}');
    expect(await store(dir).read()).toEqual({ integrity: 'corrupt', checkpoint: null });
  });
  it('preserves prior checkpoint on rename failure and retains incomplete evidence', async () => {
    const dir = await directory();
    const checkpoint = store(dir);
    await checkpoint.write({ lastSeq: 1, state: { count: 1 } });
    vi.spyOn(fs, 'rename').mockRejectedValue(new Error('rename failed'));
    await expect(checkpoint.write({ lastSeq: 2, state: { count: 2 } })).rejects.toThrow(
      'rename failed',
    );
    expect(await store(dir).read()).toMatchObject({ integrity: 'ok', checkpoint: { lastSeq: 1 } });
    expect((await fs.readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(true);
    expect(checkpoint.writable).toBe(false);
  });
  it('rejects traversal and unknown state fields', async () => {
    const dir = await directory();
    expect(() => new OperationJournal({ opsDataDir: dir, fileName: '../outside.jsonl' })).toThrow(
      'INVALID_OPERATION_PATH',
    );
    await expect(
      store(dir).write({ lastSeq: 1, state: { count: 1, secret: 'hidden' } } as never),
    ).rejects.toThrow('INVALID_SCHEMA');
  });
});

describe('journal retention checkpoint and rotation', () => {
  it('drops only eligible latest REVOKED records and replays retained generations once', async () => {
    const dir = await directory();
    const journal = create(dir);
    await journal.restore();
    await journal.append({ ...record, identity: 'done', state: 'PREPARED' });
    await journal.append({ ...record, identity: 'done', state: 'REVOKED' });
    for (const state of ['PREPARED', 'REVOKING', 'UNRESOLVED'] as const)
      await journal.append({ ...record, identity: `pending-${state}`, state });
    const eligibility = vi.fn(() => true);
    expect(await journal.compact(eligibility)).toEqual({
      lastSeq: 5,
      retained: 3,
      removed: 1,
      durable: true,
    });
    expect(eligibility).toHaveBeenCalledTimes(1);
    await journal.close();
    const next = create(dir);
    const restored = await next.restore();
    expect(restored).toMatchObject({ integrity: 'ok', lastSeq: 5, unresolved: true });
    expect(restored.records.map((entry) => entry.record.state)).toEqual([
      'PREPARED',
      'REVOKING',
      'UNRESOLVED',
    ]);
    expect(await next.append({ ...record, identity: 'next' })).toEqual({ seq: 6, durable: true });
  });

  it('keeps REVOKED data when the external retention policy denies compaction', async () => {
    const journal = create(await directory());
    await journal.restore();
    await journal.append({ ...record, state: 'REVOKED' });
    const eligibility = vi.fn(() => false);
    expect(await journal.compact(eligibility)).toMatchObject({ removed: 0, retained: 1 });
  });

  it('restores the prior checkpoint and subsequent log when checkpoint replacement fails', async () => {
    const dir = await directory();
    const journal = create(dir);
    await journal.restore();
    await journal.append({ ...record, identity: 'done', state: 'REVOKED' });
    await journal.compact(() => false);
    await journal.append({ ...record, identity: 'pending' });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (String(target) === `${journal.filePath}.checkpoint.json`)
        throw new Error('checkpoint rename interrupted');
      await rename(source, target);
    });
    await expect(journal.compact(() => true)).rejects.toThrow('checkpoint rename interrupted');
    expect(journal.writable).toBe(false);
    vi.restoreAllMocks();
    await journal.close();
    const restored = await create(dir).restore();
    expect(restored).toMatchObject({ integrity: 'ok', lastSeq: 2 });
    expect(restored.records.map((entry) => entry.record.identity)).toEqual(['done', 'pending']);
  });

  it('uses the new checkpoint after interrupted log rotation without resurrecting removed records', async () => {
    const dir = await directory();
    const journal = create(dir);
    await journal.restore();
    await journal.append({ ...record, identity: 'done', state: 'REVOKED' });
    await journal.compact(() => false);
    await journal.append({ ...record, identity: 'pending' });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (String(source).endsWith('.rotate.tmp')) throw new Error('rotation interrupted');
      await rename(source, target);
    });
    await expect(journal.compact(() => true)).rejects.toThrow('rotation interrupted');
    vi.restoreAllMocks();
    await journal.close();
    const next = create(dir);
    const restored = await next.restore();
    expect(restored).toMatchObject({ integrity: 'ok', lastSeq: 2 });
    expect(restored.records.map((entry) => entry.record.identity)).toEqual(['pending']);
    expect(await next.append({ ...record, identity: 'next' })).toMatchObject({ seq: 3 });
  });

  it('recognizes prior anchor lineage when retention changes without any new sequence', async () => {
    const dir = await directory();
    const journal = create(dir);
    await journal.restore();
    await journal.append({ ...record, state: 'REVOKED' });
    await journal.compact(() => false);
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (String(source).endsWith('.rotate.tmp')) throw new Error('rotation interrupted');
      await rename(source, target);
    });
    await expect(journal.compact(() => true)).rejects.toThrow('rotation interrupted');
    vi.restoreAllMocks();
    await journal.close();
    const next = create(dir);
    expect(await next.restore()).toMatchObject({ integrity: 'ok', records: [], lastSeq: 1 });
    expect(await next.append({ ...record, identity: 'next' })).toMatchObject({ seq: 2 });
  });

  it('restores the new anchor when reopening the rotated log was interrupted', async () => {
    const dir = await directory();
    const journal = create(dir);
    await journal.restore();
    await journal.append(record);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      if (String(file) === journal.filePath && flags === 'a') throw new Error('reopen interrupted');
      return open(file, flags, mode);
    });
    await expect(journal.compact(() => true)).rejects.toThrow('reopen interrupted');
    vi.restoreAllMocks();
    await journal.close();
    const restored = await create(dir).restore();
    expect(restored).toMatchObject({ integrity: 'ok', lastSeq: 1 });
    expect(restored.records).toHaveLength(1);
  });

  it.each(['checkpoint', 'journal'] as const)(
    'locks when the %s half of a rotated journal is lost',
    async (missing) => {
      const dir = await directory();
      const journal = create(dir);
      await journal.restore();
      await journal.append({ ...record, state: 'REVOKED' });
      await journal.compact(() => true);
      await journal.close();
      const target =
        missing === 'journal' ? journal.filePath : `${journal.filePath}.checkpoint.json`;
      await fs.rename(target, `${target}.preserved-evidence`);
      const next = create(dir);
      expect(await next.restore()).toMatchObject({
        integrity: 'corrupt',
        writable: false,
        unresolved: true,
      });
      await expect(next.compact(() => true)).rejects.toThrow('JOURNAL_NOT_WRITABLE');
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('does not overwrite corruption after a valid checkpoint', async () => {
    const dir = await directory();
    const journal = create(dir);
    await journal.restore();
    await journal.append(record);
    await journal.compact(() => true);
    await journal.close();
    await fs.appendFile(journal.filePath, '{"interrupted":');
    const original = await fs.readFile(journal.filePath, 'utf8');
    const next = create(dir);
    expect(await next.restore()).toMatchObject({ integrity: 'partial', writable: false });
    await expect(next.compact(() => true)).rejects.toThrow('JOURNAL_NOT_WRITABLE');
    expect(await fs.readFile(journal.filePath, 'utf8')).toBe(original);
  });
});
