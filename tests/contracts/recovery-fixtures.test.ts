// F-11 / QA-05 G1-B on E's real recovery path: a persisted operations volume (journal, usage
// checkpoint, retry checkpoint) left behind by a killed server is restored by a fresh process.
// Three identity states are recorded before the "kill": PREPARED but never joined, PREPARED with a
// Cloud-refreshed token (same record), and one that already left (REVOKED). The restart must stay
// RECOVERING/DRAINING with grants closed until the previous generations are cleaned up, keep an
// unresolved cleanup out of READY, lock on a damaged journal, and pass foreign rooms to nobody.
// SIGKILL of a browser-connected server and Cloud token rejection are the QA-05 Cloud half
// (tests/cloud/g1-b.cloud.test.ts), BLOCKED until the F-02 probe harness exists.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrantIssuer } from '../../server/src/media/GrantIssuer.ts';
import { MediaGenerationRegistry } from '../../server/src/media/MediaGenerationRegistry.ts';
import { CheckpointStore } from '../../server/src/operations/CheckpointStore.ts';
import {
  OperationJournal,
  type JournalRecord,
} from '../../server/src/operations/OperationJournal.ts';
import {
  createRecoveryBootstrap,
  type RecoveryCleanupInput,
} from '../../server/src/operations/RecoveryBootstrap.ts';
import type { CleanupReport } from '../../server/src/operations/RecoveryState.ts';
import { validateRetryCheckpoint } from '../../server/src/operations/RevocationRetryBindings.ts';
import { UsageBudget } from '../../server/src/operations/UsageBudget.ts';
import { UsageCheckpoint } from '../../server/src/operations/UsageCheckpoint.ts';
import {
  EPOCH_MS,
  NAMESPACE,
  capability,
  configuration,
  deferred,
  gameFrame,
  prepareRequest,
} from '../fixtures/media-recovery-scenarios.ts';

const PREFIX = 'kkakkung-f11-recovery-';
const NOW = EPOCH_MS;
const OLD_EPOCH = randomUUID();
const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
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

const room = (namespace = NAMESPACE) => `${namespace}--${OLD_EPOCH}--${randomUUID()}`;
const identityOf = (namespace = NAMESPACE) => `${namespace}--${OLD_EPOCH}--${randomUUID()}`;

type Recorded = { state: JournalRecord['state']; namespace?: string; label: string };

/** The previous server's identities as its journal recorded them right before it died. */
function recordFor(input: Recorded, roomName: string): JournalRecord {
  const namespace = input.namespace ?? NAMESPACE;
  return {
    state: input.state,
    namespace,
    matchId: 'm',
    mediaInstanceId: 'game',
    roomName,
    serverEpoch: OLD_EPOCH,
    identity: identityOf(namespace),
    generation: 1,
    issuedAtEpochMs: NOW - 60_000,
    expiresAtEpochMs: NOW + 240_000,
    reservationId: `res-${input.label}`,
    requestId: `prepare-${input.label}`,
    ...(input.state === 'REVOKED'
      ? { retirementId: `retire-${input.label}`, atEpochMs: NOW - 30_000 }
      : {}),
  };
}

const budgetFor = (opsDataDir: string, allowed: boolean) =>
  new UsageBudget({
    store: new UsageCheckpoint({ opsDataDir }),
    projectAlias: 'local-fixture',
    officialBudgetMaxAgeMs: 60_000,
    now: () => NOW,
    canIssue: () => ({ allowed }),
  });

/**
 * Writes the persisted volume of the killed server: official usage confirmed, one reservation
 * per recorded identity, the journal records, and a retry checkpoint. Returns the directory.
 */
async function killedServerVolume(records: Recorded[], options: { corrupt?: boolean } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX));
  directories.push(directory);
  const journal = new OperationJournal({ opsDataDir: directory });
  await fs.writeFile(journal.filePath, '', 'utf8');
  expect(await journal.restore()).toMatchObject({ integrity: 'ok', writable: true });
  const seed = budgetFor(directory, true);
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
  const roomName = room();
  const written: JournalRecord[] = [];
  for (const input of records) {
    const record = recordFor(input, input.namespace ? room(input.namespace) : roomName);
    if (record.namespace === NAMESPACE) {
      const reserved = await seed.reserve({
        reservationId: record.reservationId!,
        matchId: record.matchId,
        purpose: 'public',
        slots: 6,
        expectedMinutes: 5,
        expectedBytes: 1_000,
        margin: 0,
      });
      expect(reserved, JSON.stringify(reserved)).toMatchObject({ status: 'reserved' });
    }
    await journal.append(record);
    written.push(record);
  }
  const retryCheckpoint = new CheckpointStore({
    opsDataDir: directory,
    fileName: 'revocation-checkpoint.json',
    validate: validateRetryCheckpoint,
  });
  await retryCheckpoint.write({ lastSeq: 0, state: [] });
  // The old process is gone: its lease is released here only because a live test cannot SIGKILL itself.
  await journal.close();
  if (options.corrupt)
    await fs.appendFile(
      journal.filePath,
      '{"version":1,"seq":99,"record":{"state":"PREPARED"}\n',
      'utf8',
    );
  return { directory, written, roomName };
}

/** The fresh process: new journal handle, new registry epoch, cleanup owned by the test. */
async function restart(directory: string) {
  const journal = new OperationJournal({ opsDataDir: directory });
  const budget = budgetFor(directory, false);
  const retryCheckpoint = new CheckpointStore({
    opsDataDir: directory,
    fileName: 'revocation-checkpoint.json',
    validate: validateRetryCheckpoint,
  });
  const cleanup = deferred<CleanupReport>();
  const beginCleanup = vi.fn((_input: RecoveryCleanupInput) => cleanup.promise);
  const registry = new MediaGenerationRegistry(NAMESPACE);
  registry.observe(gameFrame(['p1']));
  const bootstrap = createRecoveryBootstrap({
    namespace: NAMESPACE,
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
  closers.push(async () => {
    vi.unstubAllGlobals();
  });
  const sideEffects = {
    reserve: vi.fn(async () => true),
    persist: vi.fn(async () => undefined),
    sign: vi.fn(async () => 'x'),
    onPrepared: vi.fn(),
    retire: vi.fn(),
  };
  const issuer = new GrantIssuer({
    config: { ...configuration(NOW), opsDataDir: directory },
    registry,
    nowEpochMs: () => NOW,
    canIssue: () =>
      bootstrap.getReadiness().state === 'READY' && (bootstrap.getAdmission() as string) === 'OPEN',
    capability: () => capability,
    reserve: sideEffects.reserve,
    persist: sideEffects.persist,
    retire: sideEffects.retire,
    lock: (reason) => bootstrap.state.lock(reason),
    onPrepared: sideEffects.onPrepared,
    sign: sideEffects.sign,
  });
  const expectGrantsClosed = async () => {
    expect(await issuer.prepare(prepareRequest('p1'))).toMatchObject({
      status: 'rejected',
      code: 'NOT_READY',
      grant: null,
    });
    expect(registry.all()).toHaveLength(0);
    for (const effect of Object.values(sideEffects)) expect(effect).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  };
  return { bootstrap, beginCleanup, cleanup, expectGrantsClosed, registry };
}

const cleanReport = (over: Partial<CleanupReport> = {}): CleanupReport => ({
  recordedIdentities: 2,
  observedParticipants: 1,
  revoked: 2,
  unresolved: 0,
  ownedRoomsRemaining: 0,
  historyComplete: true,
  ...over,
});

describe('G1-B: restart on the killed server’s volume', () => {
  it('RECOVERING and DRAINING first; the two live identities go to cleanup, the one that left does not; grants stay closed until READY and even then until OPEN', async () => {
    const volume = await killedServerVolume([
      { state: 'PREPARED', label: 'never-joined' },
      { state: 'PREPARED', label: 'refreshed-token' },
      { state: 'REVOKED', label: 'already-left' },
    ]);
    const s = await restart(volume.directory);
    expect(s.bootstrap.getReadiness().state).toBe('RECOVERING');
    expect(s.bootstrap.getAdmission()).toBe('DRAINING');
    const initial = await s.bootstrap.initialize();
    expect(initial).toMatchObject({ status: 'initialized', admission: 'DRAINING' });
    if (initial.status !== 'initialized') throw new Error('unreachable');
    expect(initial.readiness.state, initial.readiness.reasonCodes.join(',')).toBe('RECOVERING');
    expect(initial.readiness.reasonCodes).toEqual(['CLEANUP_PENDING']);
    await s.expectGrantsClosed();
    // Cleanup receives exactly the identities the journal still owes, not the one already revoked.
    await vi.waitFor(() => expect(s.beginCleanup).toHaveBeenCalledOnce());
    const input = s.beginCleanup.mock.calls[0]![0];
    expect(input.records).toHaveLength(3);
    expect(input.pendingRecords.map((e) => e.record.state)).toEqual(['PREPARED', 'PREPARED']);
    expect(input.pendingRecords.map((e) => e.record.identity).sort()).toEqual(
      volume.written
        .filter((r) => r.state === 'PREPARED')
        .map((r) => r.identity)
        .sort(),
    );
    expect(input.historyComplete).toBe(true);
    expect(input.beforeDispatch()).toBe(true);
    expect(input.records.every((e) => e.record.roomName === volume.roomName)).toBe(true);
    // Until the report lands nothing is READY and nothing is issued.
    await s.expectGrantsClosed();
    s.cleanup.resolve(cleanReport());
    expect(await s.bootstrap.completion()).toEqual(cleanReport());
    expect(s.bootstrap.getReadiness()).toMatchObject({
      state: 'READY',
      unresolvedCount: 0,
      historyComplete: true,
    });
    // READY is health, not admission: the operator's resume is a separate step, so grants remain closed.
    expect(s.bootstrap.getAdmission()).toBe('DRAINING');
    await s.expectGrantsClosed();
  });

  it('an unresolved cleanup keeps READY false with the count visible, and issues nothing', async () => {
    const volume = await killedServerVolume([
      { state: 'PREPARED', label: 'never-joined' },
      { state: 'PREPARED', label: 'refreshed-token' },
    ]);
    const s = await restart(volume.directory);
    await s.bootstrap.initialize();
    await vi.waitFor(() => expect(s.beginCleanup).toHaveBeenCalledOnce());
    s.cleanup.resolve(cleanReport({ revoked: 1, unresolved: 1 }));
    await s.bootstrap.completion();
    const readiness = s.bootstrap.getReadiness();
    expect(readiness.state).not.toBe('READY');
    expect(readiness.unresolvedCount).toBe(1);
    expect(readiness.reasonCodes).toContain('REMOTE_RETIREMENT_UNCONFIRMED');
    await s.expectGrantsClosed();
  });

  it('a damaged journal locks recovery: no cleanup call, no grant, live observation still possible', async () => {
    const volume = await killedServerVolume([{ state: 'PREPARED', label: 'never-joined' }], {
      corrupt: true,
    });
    const s = await restart(volume.directory);
    const initial = await s.bootstrap.initialize();
    expect(initial).toMatchObject({ status: 'initialized', admission: 'DRAINING' });
    if (initial.status !== 'initialized') throw new Error('unreachable');
    expect(initial.readiness.state).toBe('LOCKED');
    expect(initial.readiness.reasonCodes).toContain('JOURNAL_INTEGRITY');
    expect(await s.bootstrap.completion()).toBeNull();
    expect(s.beginCleanup).not.toHaveBeenCalled();
    await s.expectGrantsClosed();
  });

  it('a record from another namespace never reaches cleanup: the scope mismatch locks instead of touching a foreign room', async () => {
    const volume = await killedServerVolume([
      { state: 'PREPARED', label: 'never-joined' },
      { state: 'PREPARED', label: 'foreign', namespace: 'other-service' },
    ]);
    const s = await restart(volume.directory);
    const initial = await s.bootstrap.initialize();
    if (initial.status !== 'initialized') throw new Error('unreachable');
    expect(initial.readiness.state).toBe('LOCKED');
    expect(initial.readiness.reasonCodes).toContain('JOURNAL_SCOPE_MISMATCH');
    expect(await s.bootstrap.completion()).toBeNull();
    expect(s.beginCleanup).not.toHaveBeenCalled();
    await s.expectGrantsClosed();
  });
});
