import { createHash } from 'node:crypto';
import { checksum, strictObject } from '../../server/src/operations/CheckpointStore.js';
import { validateJournalRecord } from '../../server/src/operations/OperationJournal.js';
import {
  isEmptyReservationAbort,
  validReservationTransition,
} from '../../server/src/operations/ReservationIntent.js';
import { ownsMediaRoom } from '../../server/src/operations/PreviousGenerationCleanup.js';
import { validateCleanupCheckpoint } from '../../server/src/operations/RecoveryCleanupBindings.js';
import { validateRetryCheckpoint } from '../../server/src/operations/RevocationRetryBindings.js';
import { validateUsageState } from '../../server/src/operations/UsageCheckpoint.js';
import { validateManifest, type ReleaseManifest } from './release-sequence.mjs';

export type StartupObservation = Readonly<{
  containerId: string;
  startedAtMs: number;
  restartCount: number;
  running: boolean;
  gameImage: string;
  webImage: string;
  namespace: string;
  teamContinuousProduct: boolean;
  soleVolumeWriter: boolean;
  journalModifiedAtMs: number;
  journal: string;
  journalAnchorPresent: boolean;
  cleanup: unknown;
  retry: unknown;
  usage: unknown;
  readiness: Readonly<{ state: string; reasonCodes: readonly string[] }>;
  operations: Readonly<{ admission: string; readiness: string; unresolvedCount: number }>;
}>;

export type StartupRecoveryInput = Readonly<{
  candidate: ReleaseManifest;
  failedManifest: unknown;
  failedReport: unknown;
}>;

export type StartupRecoveryProof = Readonly<{
  failedSha: string;
  containerId: string;
  startedAtMs: number;
  journalHash: string;
  stateHash: string;
  lastSeq: number;
  identities: number;
  abortedIssuances: number;
  unresolvedQueries: number;
}>;

function blocked(): never {
  // Fixed code only. None of the raw journal, identities or operator input may escape.
  throw new Error('FAILED_STARTUP_UNCONFIRMED');
}

function checkpoint<T>(raw: unknown, validate: (value: unknown) => T) {
  const data = strictObject(raw, ['version', 'lastSeq', 'state', 'checksum']);
  if (data.version !== 1 || !Number.isSafeInteger(data.lastSeq) || (data.lastSeq as number) < 0)
    blocked();
  const payload = { version: 1, lastSeq: data.lastSeq as number, state: data.state };
  if (data.checksum !== checksum(payload)) blocked();
  return { lastSeq: payload.lastSeq, state: validate(payload.state) };
}

/** Only an unadmitted first start after a proven predecessor drain can reuse that drain proof. */
export function confirmFailedStartup(
  input: StartupRecoveryInput,
  observed: StartupObservation,
): StartupRecoveryProof {
  try {
    if (validateManifest(input.candidate).length || validateManifest(input.failedManifest).length)
      blocked();
    const failed = input.failedManifest as ReleaseManifest;
    if (
      input.candidate.profile !== 'product' ||
      input.candidate.operatingMode !== 'continuous' ||
      failed.profile !== 'product' ||
      failed.operatingMode !== 'continuous' ||
      failed.releaseSha === input.candidate.releaseSha ||
      !failed.previous ||
      checksum(failed.previous) !== checksum(input.candidate.previous)
    )
      blocked();
    const report = input.failedReport as Record<string, unknown> | null;
    if (
      report?.releaseSha !== failed.releaseSha ||
      report.tag !== failed.tag ||
      report.profile !== 'product' ||
      report.result !== 'ROLLBACK_BLOCKED' ||
      report.reason !== 'ROLLBACK_DRAIN_FAILED' ||
      report.lastGoodWritten !== false ||
      !Array.isArray(report.steps)
    )
      blocked();
    const steps = report.steps as { name: string; status: string; at: number; detail: string }[];
    // This exact prefix ends before any READY/resume/smoke or another image replacement.
    const expected = [
      ['manifest', 'PASS'],
      ['images', 'PASS'],
      ['isolation', 'PASS'],
      ['operations', 'PASS'],
      ['DRAIN terminal', 'PASS'],
      ['DRAIN state', 'PASS'],
      ['RELEASE compose up', 'PASS'],
      ['RELEASE recovering', 'INFO'],
      ['RELEASE_READY_TIMEOUT', 'FAIL'],
      ['rollback start', 'INFO'],
      ['ROLLBACK_DRAIN_FAILED', 'FAIL'],
    ];
    if (
      steps.length !== expected.length ||
      steps.some(
        (step, index) =>
          step.name !== expected[index]![0] ||
          step.status !== expected[index]![1] ||
          !Number.isSafeInteger(step.at) ||
          step.at <= 0 ||
          (index > 0 && step.at < steps[index - 1]!.at),
      ) ||
      !['admission=DRAINING unresolved=0', 'admission=LOCKED unresolved=0'].includes(
        steps[5]!.detail,
      ) ||
      steps[6]!.detail !== `tag=${failed.tag}`
    )
      blocked();
    if (
      !/^[a-f0-9]{64}$/.test(observed.containerId) ||
      !observed.running ||
      observed.restartCount !== 0 ||
      !observed.teamContinuousProduct ||
      !observed.soleVolumeWriter ||
      observed.gameImage !== failed.images.game.digest ||
      observed.webImage !== failed.images.web.digest ||
      !Number.isSafeInteger(observed.startedAtMs) ||
      observed.startedAtMs <= steps[5]!.at ||
      observed.startedAtMs > steps[6]!.at ||
      !Number.isFinite(observed.journalModifiedAtMs) ||
      observed.journalModifiedAtMs > observed.startedAtMs ||
      observed.journalAnchorPresent ||
      observed.readiness.state !== 'LOCKED' ||
      observed.readiness.reasonCodes.length !== 1 ||
      observed.readiness.reasonCodes[0] !== 'REMOTE_RETIREMENT_UNCONFIRMED' ||
      observed.operations.readiness !== 'LOCKED' ||
      !['DRAINING', 'LOCKED'].includes(observed.operations.admission)
    )
      blocked();
    const latest = new Map<string, ReturnType<typeof validateJournalRecord>>();
    let lastSeq = 0;
    if (!observed.journal.endsWith('\n')) blocked();
    for (const line of observed.journal.trimEnd().split('\n')) {
      const data = strictObject(JSON.parse(line) as unknown, [
        'version',
        'seq',
        'record',
        'checksum',
      ]);
      const record = validateJournalRecord(data.record);
      if (
        data.version !== 1 ||
        data.seq !== lastSeq + 1 ||
        data.checksum !== checksum({ version: 1, seq: data.seq, record }) ||
        record.namespace !== observed.namespace ||
        !ownsMediaRoom(observed.namespace, record.roomName) ||
        record.serverEpoch !== record.roomName.split('--')[1] ||
        (record.atEpochMs !== undefined && record.atEpochMs > observed.startedAtMs) ||
        record.expiresAtEpochMs > observed.startedAtMs
      )
        blocked();
      const key = JSON.stringify([record.roomName, record.identity, record.generation]);
      const previous = latest.get(key);
      if (
        previous &&
        (!validReservationTransition(previous, record) ||
          (['REVOKED', 'ABORTED'].includes(previous.state) && record.state !== previous.state))
      )
        blocked();
      latest.set(key, record);
      lastSeq++;
    }
    if (
      !lastSeq ||
      [...latest.values()].some((record) => !['REVOKED', 'ABORTED'].includes(record.state))
    )
      blocked();
    const cleanup = checkpoint(observed.cleanup, validateCleanupCheckpoint);
    // Match RecoveryRecords: missing retry storage is valid only when no journal record is pending.
    // Keep absence explicit in the proof/archive; never create an empty replacement file.
    const retry =
      observed.retry === null ? null : checkpoint(observed.retry, validateRetryCheckpoint);
    const usage = checkpoint(observed.usage, (value) => validateUsageState(value, true));
    const result = cleanup.state.report;
    if (
      cleanup.lastSeq !== lastSeq ||
      (retry !== null && retry.lastSeq > lastSeq) ||
      cleanup.state.namespace !== observed.namespace ||
      !cleanup.state.historyComplete ||
      cleanup.state.observedTargets.length ||
      !result?.historyComplete ||
      result.recordedIdentities !== 0 ||
      result.observedParticipants !== 0 ||
      result.revoked !== 0 ||
      result.ownedRoomsRemaining !== 0 ||
      result.unresolved <= 0 ||
      result.unresolved !== observed.operations.unresolvedCount ||
      retry?.state.some((intent) => intent.status !== 'REVOKED') ||
      usage.state.reservations.some(
        (reservation) => !['AWAITING_OFFICIAL', 'RELEASED'].includes(reservation.status),
      ) ||
      [...latest.values()].some((record) =>
        record.state === 'ABORTED'
          ? !isEmptyReservationAbort(record, usage.state.reservations)
          : !record.reservationId ||
            !usage.state.reservations.some(
              (reservation) =>
                reservation.request.reservationId === record.reservationId &&
                reservation.request.matchId === record.matchId,
            ),
      )
    )
      blocked();
    return {
      failedSha: failed.releaseSha,
      containerId: observed.containerId,
      startedAtMs: observed.startedAtMs,
      journalHash: createHash('sha256').update(observed.journal).digest('hex'),
      stateHash: checksum({
        cleanup: observed.cleanup,
        retry: observed.retry,
        usage: observed.usage,
      }),
      lastSeq,
      identities: [...latest.values()].filter((record) => record.state === 'REVOKED').length,
      abortedIssuances: [...latest.values()].filter((record) => record.state === 'ABORTED').length,
      unresolvedQueries: result.unresolved,
    };
  } catch {
    return blocked();
  }
}

export type StartupRecoveryHost = Readonly<{
  observe: () => Promise<StartupObservation>;
  /** Stop this exact container normally, verify writer release and unchanged journal, archive state. */
  stopAndArchive: (proof: StartupRecoveryProof) => Promise<void>;
}>;

export function confirmStoppedStartup(
  proof: StartupRecoveryProof,
  stopped: Readonly<{
    running: boolean;
    exitCode: number;
    writerPresent: boolean;
    otherVolumeWriters: boolean;
    journalHash: string;
    stateHash: string;
  }>,
): void {
  if (
    stopped.running ||
    stopped.exitCode !== 0 ||
    stopped.writerPresent ||
    stopped.otherVolumeWriters ||
    stopped.journalHash !== proof.journalHash ||
    stopped.stateHash !== proof.stateHash
  )
    blocked();
}

/** This only prepares a quiescent replacement. The ordinary release barrier must still run. */
export async function prepareFailedStartupRecovery(
  input: StartupRecoveryInput,
  host: StartupRecoveryHost,
): Promise<Readonly<{ code: number }>> {
  try {
    const first = confirmFailedStartup(input, await host.observe());
    const current = confirmFailedStartup(input, await host.observe());
    if (checksum(first) !== checksum(current)) blocked();
    await host.stopAndArchive(current);
    return { code: 0 };
  } catch {
    return { code: 1 };
  }
}
