import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OperationJournal, type JournalRecord } from '../../src/operations/OperationJournal.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import { canCompact, compactConfirmedRetirements } from '../../src/operations/RetentionPolicy.js';

const DAY = 86_400_000;
const directories: string[] = [];
const journals: OperationJournal[] = [];
const record: JournalRecord = {
  state: 'REVOKED',
  namespace: 'qa-e11',
  matchId: 'match-1',
  mediaInstanceId: 'media-1',
  roomName: 'qa-e11-room',
  serverEpoch: 'epoch-1',
  identity: 'identity-1',
  generation: 1,
  issuedAtEpochMs: 1_000,
  expiresAtEpochMs: 2_000,
  reservationId: 'lease-1',
  atEpochMs: 3_000,
};

function createJournal(opsDataDir: string) {
  const journal = new OperationJournal({ opsDataDir });
  journals.push(journal);
  return journal;
}

async function setup(ids = ['lease-1']) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e11-retention-'));
  directories.push(dir);
  const journal = createJournal(dir);
  await journal.restore();
  let now = 1_000;
  const store = new UsageCheckpoint({ opsDataDir: dir });
  let storageFailure: unknown;
  const write = store.write.bind(store);
  store.write = async (checkpoint) => {
    try {
      await write(checkpoint);
    } catch (error) {
      storageFailure = error;
      throw error;
    }
  };
  const budget = new UsageBudget({
    store,
    projectAlias: 'project-204',
    officialBudgetMaxAgeMs: 60_000,
    now: () => now,
    canIssue: () => ({ allowed: true }),
  });
  const official = (at: number) => ({
    projectAlias: 'project-204',
    remainingMinutes: 1_000,
    remainingBytes: 100_000,
    checkedAtEpochMs: at,
    source: 'cloud-dashboard' as const,
    checkedBy: 'operator-e',
  });
  await budget.restore({ allowInitializeMissing: true });
  await budget.reconcileOfficial(official(now), { periodId: '2026-09', version: 1 });
  for (const id of ids) {
    expect(
      (
        await budget.reserve({
          reservationId: id,
          matchId: 'match-1',
          purpose: 'public',
          slots: 6,
          expectedMinutes: 5,
          expectedBytes: 1_000,
          margin: 0,
        })
      ).status,
    ).toBe('reserved');
  }
  now = 2_000;
  for (const id of ids) expect(await budget.markRetiring(id)).toBe(true);
  now = 3_000;
  for (const id of ids) {
    const confirmed = await budget.markRemoteConfirmed(id);
    if (!confirmed && storageFailure) throw storageFailure;
    expect(confirmed).toBe(true);
  }
  await journal.append(record);
  return {
    dir,
    journal,
    budget,
    async release(idsToRelease = ids, at = 4_000, version = 2) {
      now = at;
      expect(
        (await budget.reconcileOfficial(official(now), { periodId: '2026-09', version })).status,
      ).toBe('applied');
      for (const id of idsToRelease)
        expect(
          await budget.releaseConfirmed(id, {
            remoteConfirmed: true,
            periodId: '2026-09',
            version,
          }),
        ).toBe(true);
    },
  };
}

afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close();
  for (const dir of directories.splice(0)) {
    if (
      !path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(dir).startsWith('kkakkung-e11-retention-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('confirmed retirement journal compaction', () => {
  it('preserves remote-confirmed records and reservations until an official adjustment', async () => {
    const { journal, budget } = await setup();
    expect(await compactConfirmedRetirements(journal, budget, DAY * 10)).toMatchObject({
      removed: 0,
      retained: 1,
    });
    expect(budget.snapshot().reservations[0]?.status).toBe('AWAITING_OFFICIAL');
    expect(budget.snapshot().activeMinutes).toBe(30);
  });

  it('waits 24 hours after the latest confirmation and restores unresolved records after rotation', async () => {
    const { dir, journal, budget, release } = await setup();
    for (const state of ['PREPARED', 'REVOKING', 'UNRESOLVED'] as const)
      await journal.append({ ...record, identity: `identity-${state}`, state });
    await release();
    expect(await compactConfirmedRetirements(journal, budget, 4_000 + DAY - 1)).toMatchObject({
      removed: 0,
      retained: 4,
    });
    expect(await compactConfirmedRetirements(journal, budget, 4_000 + DAY)).toMatchObject({
      removed: 1,
      retained: 3,
      durable: true,
    });
    await journal.close();
    const restored = await createJournal(dir).restore();
    expect(restored.integrity).toBe('ok');
    expect(restored.unresolved).toBe(true);
    expect(restored.records.map((entry) => entry.record.state)).toEqual([
      'PREPARED',
      'REVOKING',
      'UNRESOLVED',
    ]);
  });

  it('requires official release for every lease slice and restarts the retention clock for the last slice', async () => {
    const { journal, budget, release } = await setup(['lease-1', 'lease-1:1']);
    await release(['lease-1']);
    expect(await compactConfirmedRetirements(journal, budget, 4_000 + DAY)).toMatchObject({
      removed: 0,
    });
    await release(['lease-1:1'], 5_000 + DAY, 3);
    expect(await compactConfirmedRetirements(journal, budget, 5_000 + DAY * 2 - 1)).toMatchObject({
      removed: 0,
    });
    expect(await compactConfirmedRetirements(journal, budget, 5_000 + DAY * 2)).toMatchObject({
      removed: 1,
    });
  });

  it('retains records with missing proof, ambiguous lease prefixes or a different match', async () => {
    const { journal, budget, release } = await setup();
    await release();
    await journal.append({ ...record, identity: 'no-proof', reservationId: 'lease-10' });
    await journal.append({ ...record, identity: 'other-match', matchId: 'match-2' });
    const withoutTimestamp = { ...record };
    delete withoutTimestamp.atEpochMs;
    await journal.append({ ...withoutTimestamp, identity: 'no-time' });
    expect(await compactConfirmedRetirements(journal, budget, DAY * 10)).toMatchObject({
      removed: 1,
      retained: 3,
    });
  });

  it('preserves a root record when only a released child slice remains', async () => {
    const { journal, budget, release } = await setup(['lease-1:1']);
    await release();
    expect(await compactConfirmedRetirements(journal, budget, DAY * 10)).toMatchObject({
      removed: 0,
      retained: 1,
    });
  });

  it('rejects budget proof restored under a different Cloud project', async () => {
    const { dir, journal, release } = await setup();
    await release();
    const wrongProject = new UsageBudget({
      store: new UsageCheckpoint({ opsDataDir: dir }),
      projectAlias: 'other-project',
      officialBudgetMaxAgeMs: 60_000,
      now: () => DAY * 10,
      canIssue: () => ({ allowed: true }),
    });
    expect((await wrongProject.restore()).integrity).toBe('corrupt');
    expect(wrongProject.snapshot().reservations[0]?.status).toBe('RELEASED');
    await expect(compactConfirmedRetirements(journal, wrongProject, DAY * 10)).rejects.toThrow(
      'RETENTION_BUDGET_UNVERIFIED',
    );
    await journal.close();
    expect((await createJournal(dir).restore()).records).toHaveLength(1);
  });

  it('rejects an invalid compaction clock and treats invalid confirmation times as ineligible', async () => {
    const { journal, budget } = await setup();
    for (const now of [NaN, Infinity, -1, 0.5])
      await expect(compactConfirmedRetirements(journal, budget, now)).rejects.toThrow(
        'INVALID_RETENTION_CLOCK',
      );
    for (const time of [null, NaN, Infinity, -1, 0.5])
      expect(
        canCompact(
          {
            status: 'REVOKED',
            endedAtEpochMs: 1_000,
            revokedAtEpochMs: 2_000,
            officialAdjustedAtEpochMs: time,
          },
          DAY * 10,
        ),
      ).toBe(false);
  });
});
