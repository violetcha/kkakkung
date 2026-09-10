import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as renameModule from '../../src/operations/CheckpointRename.js';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';

const { renameCheckpoint } = renameModule;
const errno = (code: string) => Object.assign(new Error('SYNTHETIC_RENAME_FAILURE'), { code });
const directories: string[] = [];
const stores: CheckpointStore<number>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0)) {
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith('kkakkung-checkpoint-rename-')
    )
      throw new Error('UNSAFE_TEST_DIRECTORY');
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('bounded Windows checkpoint rename retries', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'retries a transient %s with the exact same source and target',
    async (code) => {
      const rename = vi.fn().mockRejectedValueOnce(errno(code)).mockResolvedValue(undefined);
      const sleep = vi.fn(async () => {});
      await renameCheckpoint('synced.tmp', 'checkpoint.json', { platform: 'win32', rename, sleep });
      expect(rename.mock.calls).toEqual([
        ['synced.tmp', 'checkpoint.json'],
        ['synced.tmp', 'checkpoint.json'],
      ]);
      expect(sleep.mock.calls).toEqual([[10]]);
    },
  );

  it('allows the fourth attempt after only 10/20/40 ms backoffs', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(errno('EPERM'))
      .mockRejectedValueOnce(errno('EACCES'))
      .mockRejectedValueOnce(errno('EBUSY'))
      .mockResolvedValue(undefined);
    const sleep = vi.fn(async () => {});
    await renameCheckpoint('synced.tmp', 'checkpoint.json', { platform: 'win32', rename, sleep });
    expect(rename).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[10], [20], [40]]);
  });

  it('throws the last native error after four failures without a fifth attempt', async () => {
    const finalError = errno('EBUSY');
    const rename = vi
      .fn()
      .mockRejectedValueOnce(errno('EPERM'))
      .mockRejectedValueOnce(errno('EACCES'))
      .mockRejectedValueOnce(errno('EPERM'))
      .mockRejectedValue(finalError);
    const sleep = vi.fn(async () => {});
    await expect(
      renameCheckpoint('synced.tmp', 'checkpoint.json', { platform: 'win32', rename, sleep }),
    ).rejects.toBe(finalError);
    expect(rename).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[10], [20], [40]]);
  });

  it.each(['EIO', 'ENOSPC', 'ENOENT', 'EXDEV'])(
    'immediately preserves non-retryable %s failures',
    async (code) => {
      const error = errno(code);
      const rename = vi.fn().mockRejectedValue(error);
      const sleep = vi.fn(async () => {});
      await expect(
        renameCheckpoint('synced.tmp', 'checkpoint.json', { platform: 'win32', rename, sleep }),
      ).rejects.toBe(error);
      expect(rename).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it.each(['EPERM', 'EACCES', 'EBUSY'])('never retries %s on Linux', async (code) => {
    const error = errno(code);
    const rename = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn(async () => {});
    await expect(
      renameCheckpoint('synced.tmp', 'checkpoint.json', { platform: 'linux', rename, sleep }),
    ).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not sleep when the first rename succeeds', async () => {
    const rename = vi.fn(async () => {});
    const sleep = vi.fn(async () => {});
    await renameCheckpoint('synced.tmp', 'checkpoint.json', { platform: 'win32', rename, sleep });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-checkpoint-rename-'));
  directories.push(directory);
  const store = new CheckpointStore({
    opsDataDir: directory,
    fileName: 'checkpoint.json',
    validate: (value: unknown) => {
      if (!Number.isSafeInteger(value)) throw new Error('INVALID_FIXTURE_STATE');
      return value as number;
    },
  });
  stores.push(store);
  await store.write({ lastSeq: 1, state: 1 });
  const original = await fs.readFile(store.filePath, 'utf8');
  return { directory, store, original };
}

describe('checkpoint storage preserves atomic replacement and failure latches', () => {
  it('keeps the prior checkpoint until the same temporary file can be renamed', async () => {
    const { directory, store, original } = await fixture();
    const nativeRename = fs.rename;
    const sources: string[] = [];
    let first = true;
    const rename = vi.fn(async (source: string, target: string) => {
      sources.push(source);
      if (first) {
        first = false;
        throw errno('EPERM');
      }
      await nativeRename(source, target);
    });
    const sleep = vi.fn(async () => {
      expect(await fs.readFile(store.filePath, 'utf8')).toBe(original);
      expect((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
    });
    vi.spyOn(renameModule, 'renameCheckpoint').mockImplementation((source, target) =>
      renameCheckpoint(source, target, { platform: 'win32', rename, sleep }),
    );
    await store.write({ lastSeq: 2, state: 2 });
    expect(new Set(sources).size).toBe(1);
    expect(rename).toHaveBeenCalledTimes(2);
    expect(await store.read()).toEqual({ integrity: 'ok', checkpoint: { lastSeq: 2, state: 2 } });
    expect(store.writable).toBe(true);
    expect((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
  });

  it('retains the old checkpoint and synced temporary evidence after retry exhaustion', async () => {
    const { directory, store, original } = await fixture();
    const finalError = errno('EACCES');
    const rename = vi.fn().mockRejectedValue(finalError);
    const sleep = vi.fn(async () => {});
    vi.spyOn(renameModule, 'renameCheckpoint').mockImplementation((source, target) =>
      renameCheckpoint(source, target, { platform: 'win32', rename, sleep }),
    );
    await expect(store.write({ lastSeq: 2, state: 2 })).rejects.toBe(finalError);
    expect(rename).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[10], [20], [40]]);
    expect(new Set(rename.mock.calls.map(([source]) => source)).size).toBe(1);
    expect(await fs.readFile(store.filePath, 'utf8')).toBe(original);
    const temporaryNames = (await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'));
    expect(temporaryNames).toHaveLength(1);
    expect(
      JSON.parse(await fs.readFile(path.join(directory, temporaryNames[0]!), 'utf8')),
    ).toMatchObject({
      lastSeq: 2,
      state: 2,
    });
    expect(store.writable).toBe(false);
    await expect(store.write({ lastSeq: 3, state: 3 })).rejects.toThrow('CHECKPOINT_NOT_WRITABLE');
    expect(rename).toHaveBeenCalledTimes(4);
    expect(await fs.readFile(store.filePath, 'utf8')).toBe(original);
  });
});
