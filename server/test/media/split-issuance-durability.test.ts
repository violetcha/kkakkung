import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrantIssuer, type GrantIssuerDeps } from '../../src/media/GrantIssuer.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { MediaUsageLease } from '../../src/operations/MediaUsageLease.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import { ownedMediaTargets } from '../../src/operations/SplitMediaOwnership.js';
import { localConfiguration, prepareRequest } from './generation-fixtures.js';
import { localSplitCapability, splitPracticeFrame } from './split-fixtures.js';

const resources: { directory: string; close: () => Promise<void> }[] = [];
afterEach(async () => {
  for (const resource of resources.splice(0).reverse()) {
    await resource.close();
    const target = path.resolve(resource.directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith('kkakkung-split-issuance-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(target, { recursive: true, force: true });
  }
});

async function fixture(limited = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-split-issuance-'));
  const now = Date.now();
  const config = {
    ...localConfiguration(now),
    subscriptionMode: 'server-forwarding' as const,
    opsDataDir: directory,
  };
  const journal = new OperationJournal({ opsDataDir: directory });
  const budgetOptions = {
    store: new UsageCheckpoint({ opsDataDir: directory, providerQuota: !limited }),
    providerQuota: !limited,
    projectAlias: config.projectAlias,
    officialBudgetMaxAgeMs: 60_000,
    now: () => now,
    canIssue: () => ({ allowed: true }),
  };
  const budget = new UsageBudget(budgetOptions);
  resources.push({
    directory,
    close: async () => {
      await budget.close();
      await journal.close();
    },
  });
  await journal.restore();
  expect(journal.writable).toBe(true);
  await budget.restore({ allowInitializeMissing: true });
  if (limited)
    await budget.reconcileOfficial(
      {
        projectAlias: config.projectAlias,
        remainingMinutes: 200,
        remainingBytes: 1_000_000_000,
        checkedAtEpochMs: now,
        source: 'cloud-dashboard',
        checkedBy: 'synthetic-test-only',
      },
      { periodId: 'synthetic-only', version: 1 },
    );
  const lease = new MediaUsageLease(budget, () => now);
  const registry = new MediaGenerationRegistry(config.namespace, false, 'split');
  expect(registry.observe(splitPracticeFrame)).toBe(true);
  const deps: GrantIssuerDeps = {
    config,
    registry,
    nowEpochMs: () => now,
    capability: () => localSplitCapability(now),
    canIssue: () => true,
    reserve: (generation) => lease.reserve(generation),
    persist: async (generation) => {
      expect(budget.snapshot().reservations).toHaveLength(2);
      await journal.append({
        state: 'PREPARED',
        namespace: config.namespace,
        matchId: generation.request.matchId,
        mediaInstanceId: generation.request.mediaInstanceId,
        roomName: generation.roomName,
        serverEpoch: generation.serverEpoch,
        identity: generation.identity,
        generation: generation.generation,
        issuedAtEpochMs: generation.issuedAtEpochMs,
        expiresAtEpochMs: generation.expiresAtEpochMs,
        splitOwnership: generation.splitOwnership,
        reservationId: generation.reservationId,
        requestId: generation.request.requestId,
      });
    },
    retire: vi.fn(),
    lock: vi.fn(),
    onPrepared: vi.fn(),
  };
  return {
    directory,
    budgetOptions,
    budget,
    journal,
    lease,
    registry,
    deps,
    issuer: new GrantIssuer(deps),
    request: { ...prepareRequest, playerId: 'p0' },
  };
}

describe('split issuer + usage lease + real durable files; no Cloud calls', () => {
  it('replays all twelve owned resources and both usage blocks after actual signing and restart', async () => {
    const f = await fixture();
    const result = await f.issuer.prepare(f.request);
    expect(result.status).toBe('ready');
    const issued = f.registry.all()[0]!;
    expect(f.budget.snapshot()).toMatchObject({ activeMinutes: 120, activeBytes: 61_500_000 });
    expect(f.lease.remaining(issued)).toBe(300_000);
    await f.budget.close();
    await f.journal.close();
    const replay = new OperationJournal({ opsDataDir: f.directory });
    const budget = new UsageBudget(f.budgetOptions);
    try {
      const journal = await replay.restore();
      const usage = await budget.restore();
      expect(journal.integrity).toBe('ok');
      expect(journal.records).toHaveLength(1);
      const record = journal.records[0]!.record;
      expect(record.splitOwnership).toEqual(issued.splitOwnership);
      expect(ownedMediaTargets(record)).toHaveLength(12);
      expect(usage.reservations.map((reservation) => reservation.request.reservationId)).toEqual([
        issued.reservationId,
        `${issued.reservationId}:1`,
      ]);
      expect(usage.activeMinutes).toBe(120);
      const serialized = await fs.readFile(f.journal.filePath, 'utf8');
      expect(serialized).not.toContain('eyJ');
      expect(result.status === 'ready' && result.grant.facePublication?.token).toBeTruthy();
    } finally {
      await budget.close();
      await replay.close();
    }
  });

  it('keeps the first reservation and issues no JWT when the actual budget rejects the second block', async () => {
    const f = await fixture(true);
    f.deps.sign = vi.fn(async () => 'must-not-sign');
    expect(await f.issuer.prepare(f.request)).toMatchObject({ status: 'unknown', grant: null });
    expect(f.deps.sign).not.toHaveBeenCalled();
    expect(f.deps.onPrepared).not.toHaveBeenCalled();
    expect(f.deps.retire).toHaveBeenCalledOnce();
    const generation = f.registry.all()[0]!;
    expect(generation.state).toBe('UNRESOLVED');
    expect(ownedMediaTargets(generation)).toHaveLength(12);
    const read = await f.budgetOptions.store.read();
    expect(read.integrity).toBe('ok');
    expect(read.checkpoint?.state.reservations).toHaveLength(1);
    expect(f.budget.snapshot().activeMinutes).toBe(60);
    expect(f.journal.readSnapshot().records).toHaveLength(0);
    expect(f.lease.remaining(generation)).toBe(0);
  });
});
