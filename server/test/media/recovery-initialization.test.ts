import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrantIssuer } from '../../src/media/GrantIssuer.js';
import {
  MediaGenerationRegistry,
  type Generation,
} from '../../src/media/MediaGenerationRegistry.js';
import type { MediaInitializationResult } from '../../src/media/types.js';
import { CheckpointStore } from '../../src/operations/CheckpointStore.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import {
  createRecoveryBootstrap,
  type RecoveryBootstrap,
  type RecoveryCleanupInput,
} from '../../src/operations/RecoveryBootstrap.js';
import type { CleanupReport } from '../../src/operations/RecoveryState.js';
import { validateRetryCheckpoint } from '../../src/operations/RevocationRetryBindings.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint } from '../../src/operations/UsageCheckpoint.js';
import {
  deferred,
  localCapability,
  localConfiguration,
  practiceFrame,
  prepareRequest,
} from './generation-fixtures.js';

const PREFIX = 'kkakkung-e12-ports-';
const NOW = 1_800_000_000_000;
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const cleaned: CleanupReport = {
  recordedIdentities: 0,
  observedParticipants: 0,
  revoked: 0,
  unresolved: 0,
  ownedRoomsRemaining: 0,
  historyComplete: true,
};

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith(PREFIX)
    )
      throw new Error('UNEXPECTED_TEST_DIRECTORY');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

/** Contract consumer only. B owns real HTTP listen and the complete MediaCoordinator assembly. */
async function startHttpAfterLocalInitialization(
  bootstrap: Pick<RecoveryBootstrap, 'initialize' | 'close'>,
  listen: (result: Extract<MediaInitializationResult, { status: 'initialized' }>) => Promise<void>,
): Promise<MediaInitializationResult> {
  let result: MediaInitializationResult;
  try {
    result = await bootstrap.initialize();
  } catch (error) {
    await bootstrap.close();
    throw error;
  }
  if (result.status === 'fatal') {
    await bootstrap.close();
    return result;
  }
  await listen(result);
  return result;
}

async function fixture(options: { missingJournal?: boolean; invalidDirectory?: boolean } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX));
  directories.push(directory);
  let opsDataDir = directory;
  if (options.invalidDirectory) {
    opsDataDir = path.join(directory, 'not-a-directory');
    await fs.writeFile(opsDataDir, 'local storage failure fixture', 'utf8');
  }
  const journal = new OperationJournal({ opsDataDir });
  const makeBudget = () =>
    new UsageBudget({
      store: new UsageCheckpoint({ opsDataDir }),
      projectAlias: 'local-fixture',
      officialBudgetMaxAgeMs: 60_000,
      now: () => NOW,
      canIssue: () => ({ allowed: false }),
    });
  const retryCheckpoint = new CheckpointStore({
    opsDataDir,
    fileName: 'revocation-checkpoint.json',
    validate: validateRetryCheckpoint,
  });
  if (!options.invalidDirectory) {
    // Explicit local test evidence: a normal empty persisted installation, not inferred absence.
    if (!options.missingJournal) await fs.writeFile(journal.filePath, '', 'utf8');
    const seed = makeBudget();
    await seed.restore({ allowInitializeMissing: true });
    expect(
      await seed.reconcileOfficial(
        {
          projectAlias: 'local-fixture',
          remainingMinutes: 1_000,
          remainingBytes: 1_000_000,
          checkedAtEpochMs: NOW,
          source: 'cloud-dashboard',
          checkedBy: 'synthetic-local-operator',
        },
        { periodId: 'local-period', version: 1 },
      ),
    ).toEqual({ status: 'applied' });
    await retryCheckpoint.write({ lastSeq: 0, state: [] });
  }
  const budget = makeBudget();
  const cleanup = deferred<CleanupReport>();
  // This controlled report is local evidence only. No E-13 implementation or Cloud client is used.
  const beginCleanup = vi.fn((_input: RecoveryCleanupInput) => cleanup.promise);
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe(practiceFrame);
  const bootstrap = createRecoveryBootstrap({
    namespace: 'e-fixture',
    journal,
    usageBudget: budget,
    retryCheckpoint,
    nowEpochMs: () => NOW,
    monotonicNow: () => 125,
    officialBudgetMaxAgeMs: 60_000,
    serverEpoch: registry.serverEpoch,
    beginCleanup,
  });
  closers.push(() => bootstrap.close());
  const network = vi.fn(async () => {
    throw new Error('UNEXPECTED_TEST_NETWORK');
  });
  vi.stubGlobal('fetch', network);
  const reserve = vi.fn(async (generation: Generation) => {
    const reserved = await budget.reserve({
      reservationId: generation.reservationId,
      matchId: generation.request.matchId,
      purpose: 'public',
      slots: 6,
      expectedMinutes: 5,
      expectedBytes: 1_000,
      margin: 0,
    });
    return reserved.status !== 'rejected';
  });
  const persist = vi.fn(async () => {
    throw new Error('UNEXPECTED_GRANT_PERSIST');
  });
  const sign = vi.fn(async () => {
    throw new Error('UNEXPECTED_TOKEN_SIGNING');
  });
  const onPrepared = vi.fn();
  const retire = vi.fn();
  const isOpen = (admission: string) => admission === 'OPEN';
  const issuer = new GrantIssuer({
    config: { ...localConfiguration(NOW), opsDataDir },
    registry,
    nowEpochMs: () => NOW,
    canIssue: () => bootstrap.getReadiness().state === 'READY' && isOpen(bootstrap.getAdmission()),
    capability: () => localCapability,
    reserve,
    persist,
    retire,
    lock: (reason) => bootstrap.state.lock(reason),
    onPrepared,
    sign,
  });
  async function expectGrantClosed() {
    expect(await issuer.prepare(prepareRequest)).toMatchObject({
      status: 'rejected',
      code: 'NOT_READY',
      receiverGeneration: null,
      grant: null,
    });
    expect(registry.all()).toHaveLength(0);
    for (const sideEffect of [reserve, persist, sign, onPrepared, retire, network])
      expect(sideEffect).not.toHaveBeenCalled();
  }
  return { bootstrap, budget, journal, beginCleanup, cleanup, directory, expectGrantClosed };
}

describe('E-12 initialization producer ports and the existing grant issuer', () => {
  it('allows health listen before delayed cleanup and keeps grants closed through local READY/DRAINING', async () => {
    const s = await fixture();
    expect(s.bootstrap).not.toBeInstanceOf(Promise);
    expect(s.bootstrap.getReadiness().state).toBe('RECOVERING');
    expect(s.bootstrap.getAdmission()).toBe('DRAINING');
    await s.expectGrantClosed();

    const restore = vi.spyOn(s.journal, 'restore');
    const close = vi.spyOn(s.bootstrap, 'close');
    const listen = vi.fn(
      async (initial: Extract<MediaInitializationResult, { status: 'initialized' }>) => {
        expect(initial).toEqual({
          status: 'initialized',
          readiness: {
            state: 'RECOVERING',
            reasonCodes: ['CLEANUP_PENDING'],
            historyComplete: true,
            unresolvedCount: 0,
          },
          admission: 'DRAINING',
        });
        expect(s.bootstrap.getReadiness().state).toBe('RECOVERING');
      },
    );
    const initial = await startHttpAfterLocalInitialization(s.bootstrap, listen);
    expect(listen).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();
    expect(s.beginCleanup).toHaveBeenCalledOnce();
    expect(s.beginCleanup.mock.calls[0]![0].beforeDispatch()).toBe(true);
    await s.expectGrantClosed();

    s.cleanup.resolve(cleaned);
    expect(await s.bootstrap.completion()).toEqual(cleaned);
    expect(s.bootstrap.getReadiness().state).toBe('READY');
    expect(s.bootstrap.getAdmission()).toBe('DRAINING');
    await s.expectGrantClosed();
    expect(await s.bootstrap.initialize()).toBe(initial);
    expect(initial).toMatchObject({ readiness: { state: 'RECOVERING' }, admission: 'DRAINING' });
    expect(restore).toHaveBeenCalledOnce();
    expect(s.beginCleanup).toHaveBeenCalledOnce();
    await s.bootstrap.close();
    await s.expectGrantClosed();
  });

  it('allows initialized/LOCKED observation for missing history while denying every grant', async () => {
    const s = await fixture({ missingJournal: true });
    const listen = vi.fn(async () => {});
    const close = vi.spyOn(s.bootstrap, 'close');
    const initial = await startHttpAfterLocalInitialization(s.bootstrap, listen);
    expect(initial).toMatchObject({
      status: 'initialized',
      readiness: { state: 'LOCKED', historyComplete: false },
      admission: 'DRAINING',
    });
    expect(listen).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(s.beginCleanup).not.toHaveBeenCalled();
    expect(await s.bootstrap.completion()).toBeNull();
    await s.expectGrantClosed();
  });

  it('closes a conflicting writer without listen and preserves the existing writer lease', async () => {
    const s = await fixture();
    const existingWriter = new OperationJournal({ opsDataDir: s.directory });
    closers.push(() => existingWriter.close());
    expect(await existingWriter.restore()).toMatchObject({ integrity: 'ok', writable: true });
    const listen = vi.fn(async () => {});
    const close = vi.spyOn(s.bootstrap, 'close');
    expect(await startHttpAfterLocalInitialization(s.bootstrap, listen)).toEqual({
      status: 'fatal',
      code: 'WRITER_CONFLICT',
    });
    expect(listen).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(existingWriter.writable).toBe(true);
    expect(s.beginCleanup).not.toHaveBeenCalled();
    await s.expectGrantClosed();
  });

  it('closes after an unsafe local storage failure without listen or issuing a token', async () => {
    const s = await fixture({ invalidDirectory: true });
    const listen = vi.fn(async () => {});
    const close = vi.spyOn(s.bootstrap, 'close');
    expect(await startHttpAfterLocalInitialization(s.bootstrap, listen)).toEqual({
      status: 'fatal',
      code: 'INITIALIZATION_FAILED',
    });
    expect(listen).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(s.beginCleanup).not.toHaveBeenCalled();
    await s.expectGrantClosed();
  });
});
