import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationJournal, type JournalRecord } from '../../src/operations/OperationJournal.js';

const directories: string[] = [];
const journals: OperationJournal[] = [];
const gates: (() => void)[] = [];
const record: JournalRecord = {
  state: 'PREPARED',
  namespace: 'e14-observation',
  matchId: 'match-1',
  mediaInstanceId: 'media-1',
  roomName: 'e14-observation-room',
  serverEpoch: 'epoch-1',
  identity: 'synthetic-identity',
  generation: 1,
  issuedAtEpochMs: 1000,
  expiresAtEpochMs: 2000,
};

async function create() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e14-journal-observation-'));
  directories.push(dir);
  const journal = new OperationJournal({ opsDataDir: dir });
  journals.push(journal);
  return journal;
}

async function handlePrototype(journal: OperationJournal) {
  const handle = await fs.open(`${journal.filePath}.prototype-fixture`, 'a');
  const prototype = Object.getPrototypeOf(handle) as { sync: () => Promise<void> };
  await handle.close();
  return prototype;
}

afterEach(async () => {
  for (const release of gates.splice(0)) release();
  vi.restoreAllMocks();
  for (const journal of journals.splice(0)) await journal.close();
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('kkakkung-e14-journal-observation-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('current durable journal observation', () => {
  it('does not claim a writer or flush before initialization', async () => {
    const journal = await create();
    expect(journal.snapshot()).toEqual({ lastSeq: 0, records: [], writable: false });
    await expect(journal.flush()).rejects.toThrow('JOURNAL_NOT_WRITABLE');
  });

  it('returns current latest generations independently of the cached boot replay', async () => {
    const journal = await create();
    const boot = await journal.restore();
    await journal.append(record);
    await journal.append({ ...record, identity: 'second-identity', generation: 2 });
    await journal.append({ ...record, state: 'REVOKED' });
    await journal.flush();
    expect(boot.records).toEqual([]);
    expect(await journal.restore()).toBe(boot);
    expect(journal.snapshot()).toMatchObject({
      lastSeq: 3,
      writable: true,
      records: [
        { seq: 2, record: { identity: 'second-identity', state: 'PREPARED' } },
        { seq: 3, record: { identity: 'synthetic-identity', state: 'REVOKED' } },
      ],
    });
  });

  it('defensively clones nested records and the returned collection', async () => {
    const journal = await create();
    await journal.restore();
    await journal.append(record);
    const changed = journal.snapshot();
    const cloned = changed.records as unknown as { record: { state: string } }[];
    cloned[0]!.record.state = 'REVOKED';
    cloned.splice(0);
    expect(journal.snapshot().records[0]?.record.state).toBe('PREPARED');
  });

  it('omits a pending append from observation and waits for its fsync before flush succeeds', async () => {
    const journal = await create();
    await journal.restore();
    const before = journal.readSnapshot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    gates.push(release);
    const sync = vi.spyOn(await handlePrototype(journal), 'sync').mockImplementation(() => gate);
    const append = journal.append(record);
    await vi.waitFor(() => expect(sync).toHaveBeenCalled());
    let flushed = false;
    const flush = journal.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(journal.snapshot()).toMatchObject({ lastSeq: 0, records: [] });
    expect(journal.readSnapshot().records).toBe(before.records);
    expect(flushed).toBe(false);
    release();
    await Promise.all([append, flush]);
    expect(journal.snapshot()).toMatchObject({ lastSeq: 1, records: [{ seq: 1 }] });
    expect(journal.readSnapshot().records).not.toBe(before.records);
    expect(journal.readSnapshot()).toMatchObject({
      lastSeq: 1,
      records: [{ seq: 1, record: { state: 'PREPARED' } }],
    });
  });

  it('rejects flush after a failed accepted append and preserves only previously durable evidence', async () => {
    const journal = await create();
    await journal.restore();
    await journal.append(record);
    const before = journal.readSnapshot();
    vi.spyOn(await handlePrototype(journal), 'sync').mockRejectedValue(new Error('fixture fsync'));
    const append = journal.append({ ...record, state: 'REVOKED' });
    const flush = journal.flush();
    await expect(append).rejects.toThrow('fixture fsync');
    await expect(flush).rejects.toThrow('JOURNAL_NOT_WRITABLE');
    expect(journal.snapshot()).toMatchObject({
      lastSeq: 1,
      writable: false,
      records: [{ record: { state: 'PREPARED' } }],
    });
    expect(journal.readSnapshot().records).toBe(before.records);
    expect(journal.readSnapshot().writable).toBe(false);
  });

  it('rejects confirmation once shutdown starts while keeping evidence observable', async () => {
    const journal = await create();
    await journal.restore();
    await journal.append(record);
    const close = journal.close();
    expect(journal.snapshot().writable).toBe(false);
    await expect(journal.flush()).rejects.toThrow('JOURNAL_NOT_WRITABLE');
    await close;
    expect(journal.snapshot().records).toHaveLength(1);
  });

  it('reflects retained state after durable compaction without inventing a new sequence', async () => {
    const journal = await create();
    await journal.restore();
    await journal.append({ ...record, state: 'REVOKED' });
    await journal.append({ ...record, generation: 2, identity: 'second-identity' });
    const before = journal.readSnapshot();
    await journal.compact(() => true);
    await journal.flush();
    expect(journal.snapshot()).toMatchObject({
      lastSeq: 2,
      records: [{ seq: 2, record: { state: 'PREPARED' } }],
    });
    expect(journal.readSnapshot().records).not.toBe(before.records);
    expect(journal.readSnapshot()).toMatchObject({
      lastSeq: before.lastSeq,
      records: [{ seq: 2, record: { state: 'PREPARED' } }],
    });
  });
});

it('reuses immutable durable records and invalidates on writes while writer status stays live', async () => {
  const journal = await create();
  await journal.restore();
  await journal.append(record);
  const first = journal.readSnapshot();
  expect(journal.readSnapshot().records).toBe(first.records);
  expect(() => {
    first.records[0]!.record.state = 'REVOKED';
  }).toThrow();
  const detached = journal.snapshot();
  detached.records[0]!.record.state = 'REVOKED';
  expect(journal.readSnapshot().records[0]!.record.state).toBe('PREPARED');
  await journal.append({ ...record, state: 'REVOKED' });
  expect(journal.readSnapshot().records).not.toBe(first.records);
  expect(journal.readSnapshot().records[0]!.record.state).toBe('REVOKED');
  await journal.close();
  expect(journal.readSnapshot().writable).toBe(false);
});
