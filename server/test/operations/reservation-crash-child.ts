// Subprocess fault injector. Product factory/files/JWT signer are real; Cloud and capability are synthetic.
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AccessToken, ParticipantInfo, Room, TrackSource } from 'livekit-server-sdk';
import { createMediaCoordinator } from '../../src/media/MediaCoordinator.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { OperationJournal, type JournalRecord } from '../../src/operations/OperationJournal.js';
import { MediaUsageLease } from '../../src/operations/MediaUsageLease.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { UsageCheckpoint, type UsageRequest } from '../../src/operations/UsageCheckpoint.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import { localConfiguration, prepareRequest } from '../media/generation-fixtures.js';
import { localSplitCapability, splitPracticeFrame } from '../media/split-fixtures.js';

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  directory: string;
  boundary: string;
  epoch: number;
};
const config = {
  ...localConfiguration(input.epoch),
  subscriptionMode: 'server-forwarding' as const,
  operatingMode: 'continuous' as const,
  opsDataDir: input.directory,
  maxConcurrentParticipants: 100,
};
await fs.writeFile(
  path.join(input.directory, 'capability-report.json'),
  JSON.stringify(localSplitCapability(input.epoch)),
);
const crash = async (signed = false) => {
  await fs.writeFile(
    path.join(input.directory, 'crash-observation.json'),
    JSON.stringify({ boundary: input.boundary, signed }),
  );
  process.exit(19); // No coordinator/journal close: the next writer must recover an abandoned lease.
};

if (input.boundary === 'second-rejected') {
  const journal = new OperationJournal({ opsDataDir: input.directory });
  await journal.restore();
  const audit = new OperationsAudit({
    opsDataDir: input.directory,
    nowEpochMs: () => input.epoch,
    isWritable: () => journal.writable,
    allowMissingHistory: () => true,
  });
  await audit.restore();
  const budget = new UsageBudget({
    store: new UsageCheckpoint({ opsDataDir: input.directory, isWritable: () => journal.writable }),
    projectAlias: config.projectAlias,
    officialBudgetMaxAgeMs: 60_000,
    now: () => input.epoch,
    canIssue: () => ({ allowed: true }),
  });
  await budget.restore({ allowInitializeMissing: true });
  await budget.reconcileOfficial(
    {
      projectAlias: config.projectAlias,
      remainingMinutes: 200,
      remainingBytes: 1_000_000_000,
      checkedAtEpochMs: input.epoch,
      source: 'cloud-dashboard',
      checkedBy: 'synthetic-child-only',
    },
    { periodId: 'synthetic-only', version: 1 },
  );
  const registry = new MediaGenerationRegistry(config.namespace, false, 'split');
  registry.observe(splitPracticeFrame);
  const generation = registry.allocate({ ...prepareRequest, playerId: 'p0' }, input.epoch);
  const lease = new MediaUsageLease(budget, () => input.epoch);
  const requests = lease.prepareReservation(generation);
  const record: JournalRecord = {
    state: 'PREPARED',
    namespace: config.namespace,
    matchId: generation.request.matchId,
    mediaInstanceId: generation.request.mediaInstanceId,
    serverEpoch: generation.serverEpoch,
    roomName: generation.roomName,
    identity: generation.identity,
    generation: generation.generation,
    issuedAtEpochMs: generation.issuedAtEpochMs,
    expiresAtEpochMs: generation.expiresAtEpochMs,
    splitOwnership: generation.splitOwnership,
    reservationId: generation.reservationId,
  };
  await journal.prepareReservation(record, { phase: 'RESERVING', requests });
  try {
    await lease.reserve(generation);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'PARTIAL_RESERVATION_UNCONFIRMED' &&
      budget.snapshot().reservations.length === 1
    )
      await crash();
    throw error;
  }
  throw new Error('EXPECTED_REAL_BUDGET_REJECTION');
}

const prepare = OperationJournal.prototype.prepareReservation;
OperationJournal.prototype.prepareReservation = async function (...args) {
  const result = await prepare.apply(this, args);
  if (input.boundary === 'intent-only') await crash();
  return result;
};
const reserve = UsageBudget.prototype.reserve;
UsageBudget.prototype.reserve = async function (this: UsageBudget, request: UsageRequest) {
  const result = await reserve.call(this, request);
  const count = this.snapshot().reservations.length;
  if (
    result.status === 'reserved' &&
    ((input.boundary === 'first-reservation' && count === 1) ||
      (input.boundary === 'all-reserved' && count === 2))
  )
    await crash();
  return result;
};
const coordinator = createMediaCoordinator(
  {
    config,
    monotonicNow: () => performance.now(),
    epochNowSeconds: () => input.epoch / 1000,
    emitMetric: () => {},
    enqueueControl: () => {},
    enqueueBindings: () => {},
    enqueueAudioPolicy: () => {},
    getGameActivity: () => ({ activeMatches: 0, activePractices: 0, pendingAdmissions: 0 }),
  },
  {
    mediaMode: () => 'cloud',
    productSecurityReady: () => true,
    namespaceOwnershipConfirmed: () => true,
    firstInstallationConfirmed: async () => true,
    firstAuditConfirmed: () => true,
    clientFactory: () => ({
      listRooms: async () => [],
      listParticipants: async () => [],
      removeParticipant: async () => {},
      deleteRoom: async () => {},
      createRoom: async (request) => new Room({ name: request.name }),
      getParticipant: async () => {
        throw { code: 'not_found', status: 404 };
      },
      updateParticipant: async () => new ParticipantInfo(),
      updateSubscriptions: async () => {},
      forwardParticipant: async () => {
        throw new Error('NO_MEDIA_IN_THIS_CRASH_TEST');
      },
    }),
    sign: async (generation, publication) => {
      if (input.boundary !== 'first-signed' || publication !== 'receiver')
        throw new Error('UNEXPECTED_SIGNING');
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity: generation.identity,
        ttl: 300,
      });
      token.addGrant({
        roomJoin: true,
        room: generation.roomName,
        canSubscribe: true,
        canPublishData: false,
        canPublishSources: [TrackSource.MICROPHONE],
      });
      await token.toJwt();
      await crash(true);
      throw new Error('CRASH_DID_NOT_EXIT');
    },
  },
);
await coordinator.initialize();
const until = performance.now() + 5000;
while (coordinator.getReadiness().state !== 'READY' && performance.now() < until)
  await new Promise((resolve) => setTimeout(resolve, 5));
if (coordinator.getReadiness().state !== 'READY') throw new Error('FIXTURE_NOT_READY');
const operations = coordinator.getOperations();
operations.submit({ requestId: 'open-crash-fixture', action: 'resume' });
while (
  operations.getSnapshot('open-crash-fixture')?.status !== 'succeeded' &&
  performance.now() < until
)
  await new Promise((resolve) => setTimeout(resolve, 5));
for (const participant of splitPracticeFrame.participants)
  coordinator.lifecycle.setGameConnection({
    matchId: splitPracticeFrame.matchId,
    playerId: participant.playerId,
    connected: true,
  });
coordinator.observeFrame(splitPracticeFrame);
await coordinator.prepareGeneration({ ...prepareRequest, playerId: 'p0' });
throw new Error('EXPECTED_CRASH_BOUNDARY_NOT_REACHED');
