import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckpointStore, checksum } from '../../src/operations/CheckpointStore.js';
import { SharedRetryCheckpoint } from '../../src/operations/SharedRetryCheckpoint.js';
import { validateRetryIntent, type RetryIntent } from '../../src/operations/RevocationRetries.js';

const directories: string[] = [];
const stores: SharedRetryCheckpoint[] = [];

function intent(id: string, changes: Partial<RetryIntent> = {}): RetryIntent {
  return {
    retirementId: id,
    reservationId: `reservation-${id}`,
    identity: `identity-${id}`,
    generation: 1,
    firstRetireEpochMs: 1000,
    lastAttemptEpochMs: null,
    nextAttemptEpochMs: 2000,
    attempt: 0,
    status: 'REVOKING',
    alarmed: false,
    providerWaitUnknown: false,
    ...changes,
  };
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-shared-retry-'));
  directories.push(directory);
  const lease = { writable: true };
  const store = new SharedRetryCheckpoint({
    opsDataDir: directory,
    isWritable: () => lease.writable,
  });
  stores.push(store);
  return { directory, lease, store };
}

async function disk(store: SharedRetryCheckpoint) {
  const raw = JSON.parse(await fs.readFile(store.filePath, 'utf8')) as {
    version: number;
    lastSeq: number;
    state: RetryIntent[];
    checksum: string;
  };
  expect(raw.checksum).toBe(
    checksum({ version: raw.version, lastSeq: raw.lastSeq, state: raw.state }),
  );
  return raw;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('shared current and recovery retry checkpoint', () => {
  it('reports missing history without creating a checkpoint', async () => {
    const { store, directory } = await fixture();
    expect(await store.read()).toEqual({ integrity: 'missing', checkpoint: null });
    expect(await store.read()).toEqual({ integrity: 'missing', checkpoint: null });
    expect(await fs.readdir(directory)).toEqual([]);
    expect(store.writable).toBe(true);
  });

  it('merges disjoint concurrent engine snapshots and never lowers the journal boundary', async () => {
    const { store } = await fixture();
    const recovery = intent('recovery');
    const current = intent('current');
    await Promise.all([
      store.write({ lastSeq: 12, state: [recovery] }),
      store.write({ lastSeq: 10, state: [current] }),
    ]);
    const saved = await disk(store);
    expect(saved.lastSeq).toBe(12);
    expect(saved.state).toEqual([recovery, current]);
    expect(await store.read()).toEqual({
      integrity: 'ok',
      checkpoint: { lastSeq: 12, state: [recovery, current] },
    });
  });

  it('preserves omitted identities across updates and empty snapshots', async () => {
    const { store } = await fixture();
    const recovery = intent('recovery');
    const current = intent('current');
    await store.write({ lastSeq: 1, state: [recovery] });
    await store.write({ lastSeq: 2, state: [current] });
    const confirmed = intent('recovery', { status: 'REVOKED', nextAttemptEpochMs: null });
    await store.write({ lastSeq: 3, state: [confirmed] });
    await store.write({ lastSeq: 0, state: [] });
    expect((await disk(store)).state).toEqual([confirmed, current]);
    expect((await disk(store)).lastSeq).toBe(3);
  });

  it('loads existing disk evidence before the first write without an explicit read', async () => {
    const { store, directory } = await fixture();
    const raw = new CheckpointStore<readonly RetryIntent[]>({
      opsDataDir: directory,
      fileName: 'revocation-checkpoint.json',
      validate: (value) => (value as unknown[]).map(validateRetryIntent),
    });
    await raw.write({ lastSeq: 25, state: [intent('previous-boot')] });
    await raw.close();
    await store.write({ lastSeq: 26, state: [intent('current-boot')] });
    expect((await disk(store)).state.map((value) => value.retirementId)).toEqual([
      'previous-boot',
      'current-boot',
    ]);
  });

  it('captures mutable input before the shared write queue runs and returns detached reads', async () => {
    const { store } = await fixture();
    const value = { ...intent('captured') };
    const input = { lastSeq: 5, state: [value] };
    const writing = store.write(input);
    input.lastSeq = 900;
    value.identity = 'mutated';
    input.state.push(intent('injected'));
    await writing;
    expect((await disk(store)).lastSeq).toBe(5);
    expect((await disk(store)).state).toEqual([intent('captured')]);
    const read = await store.read();
    if (read.integrity !== 'ok') throw new Error('TEST_HISTORY_MISSING');
    (read.checkpoint.state[0] as { identity: string }).identity = 'read-mutated';
    expect(await store.read()).toMatchObject({ checkpoint: { state: [intent('captured')] } });
  });

  it.each([
    { identity: 'different-identity' },
    { reservationId: 'different-reservation' },
    { generation: 2 },
    { firstRetireEpochMs: 999 },
  ])('rejects identity changes under the same retirement id: %j', async (change) => {
    const { store } = await fixture();
    await store.write({ lastSeq: 1, state: [intent('old')] });
    await expect(store.write({ lastSeq: 2, state: [intent('old', change)] })).rejects.toThrow(
      'RETRY_CHECKPOINT_IDENTITY_CONFLICT',
    );
    expect(store.writable).toBe(false);
    expect((await disk(store)).state).toEqual([intent('old')]);
    await expect(store.write({ lastSeq: 3, state: [] })).rejects.toThrow('CHECKPOINT_NOT_WRITABLE');
  });

  it('rejects a second retirement id claiming an already owned identity', async () => {
    const { store } = await fixture();
    await store.write({ lastSeq: 1, state: [intent('old')] });
    await expect(
      store.write({ lastSeq: 2, state: [intent('other', { identity: 'identity-old' })] }),
    ).rejects.toThrow('RETRY_CHECKPOINT_IDENTITY_CONFLICT');
    expect(store.writable).toBe(false);
    expect((await disk(store)).state).toEqual([intent('old')]);
  });

  it.each([
    { attempt: 1, lastAttemptEpochMs: 1800 },
    { attempt: 2, lastAttemptEpochMs: 1700 },
    { attempt: 2, lastAttemptEpochMs: null },
  ])('rejects stale retry progress: %j', async (change) => {
    const { store } = await fixture();
    const progress = intent('retry', { attempt: 2, lastAttemptEpochMs: 1800 });
    await store.write({ lastSeq: 4, state: [progress] });
    await expect(store.write({ lastSeq: 5, state: [intent('retry', change)] })).rejects.toThrow(
      'RETRY_CHECKPOINT_REGRESSION',
    );
    expect(store.writable).toBe(false);
    expect((await disk(store)).state).toEqual([progress]);
  });

  it('keeps terminal confirmation and rejects a late unconfirmed snapshot', async () => {
    const { store } = await fixture();
    const confirmed = intent('retired', { status: 'REVOKED', nextAttemptEpochMs: null });
    await store.write({ lastSeq: 1, state: [confirmed] });
    await store.write({ lastSeq: 2, state: [confirmed] });
    await expect(store.write({ lastSeq: 3, state: [intent('retired')] })).rejects.toThrow(
      'RETRY_CHECKPOINT_REGRESSION',
    );
    expect((await disk(store)).state).toEqual([confirmed]);
  });

  it('allows the recovery first-attempt intent to become a scheduled retry', async () => {
    const { store } = await fixture();
    await store.write({
      lastSeq: 1,
      state: [
        intent('prepared', {
          status: 'UNRESOLVED',
          providerWaitUnknown: true,
          alarmed: true,
          nextAttemptEpochMs: null,
        }),
      ],
    });
    await store.write({ lastSeq: 2, state: [intent('prepared')] });
    expect((await disk(store)).state).toEqual([intent('prepared')]);
  });

  it('rejects corrupt existing history without overwriting its evidence', async () => {
    const { store } = await fixture();
    const broken = '{ incomplete retry checkpoint';
    await fs.writeFile(store.filePath, broken);
    await expect(store.write({ lastSeq: 10, state: [intent('new')] })).rejects.toThrow(
      'RETRY_CHECKPOINT_CORRUPT',
    );
    expect(store.writable).toBe(false);
    expect(await fs.readFile(store.filePath, 'utf8')).toBe(broken);
    expect(await store.read()).toEqual({ integrity: 'corrupt', checkpoint: null });
  });

  it('detects deletion of a previously loaded checkpoint rather than resetting the union', async () => {
    const { store } = await fixture();
    await store.write({ lastSeq: 1, state: [intent('saved')] });
    await fs.unlink(store.filePath);
    expect(await store.read()).toEqual({ integrity: 'corrupt', checkpoint: null });
    expect(store.writable).toBe(false);
    await expect(store.write({ lastSeq: 2, state: [] })).rejects.toThrow('CHECKPOINT_NOT_WRITABLE');
  });

  it('fails closed when the journal lease is lost before an accepted write executes', async () => {
    const { store, lease } = await fixture();
    const write = store.write({ lastSeq: 1, state: [intent('pending')] });
    lease.writable = false;
    await expect(write).rejects.toThrow('CHECKPOINT_NOT_WRITABLE');
    expect(store.writable).toBe(false);
  });

  it('preserves the last checkpoint and locks after a physical commit failure', async () => {
    const { store } = await fixture();
    await store.write({ lastSeq: 1, state: [intent('saved')] });
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('INJECTED_RENAME_FAILURE'));
    await expect(store.write({ lastSeq: 2, state: [intent('new')] })).rejects.toThrow(
      'INJECTED_RENAME_FAILURE',
    );
    expect(store.writable).toBe(false);
    expect((await disk(store)).state).toEqual([intent('saved')]);
  });

  it('seals new writes synchronously while close drains all previously accepted merges', async () => {
    const { store } = await fixture();
    const first = store.write({ lastSeq: 1, state: [intent('first')] });
    const second = store.write({ lastSeq: 2, state: [intent('second')] });
    const closing = store.close();
    expect(store.close()).toBe(closing);
    expect(store.writable).toBe(false);
    await expect(store.write({ lastSeq: 3, state: [intent('late')] })).rejects.toThrow(
      'CHECKPOINT_NOT_WRITABLE',
    );
    await Promise.all([first, second, closing]);
    expect((await disk(store)).state).toEqual([intent('first'), intent('second')]);
    expect(await store.read()).toMatchObject({ integrity: 'ok' });
  });
});
