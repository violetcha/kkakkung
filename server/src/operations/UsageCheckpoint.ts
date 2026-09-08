import fs from 'node:fs/promises';
import type { OfficialBudgetCheckpoint } from '../media/types.js';
import {
  CheckpointStore,
  nonnegative,
  operationPath,
  safeIdentifier,
  strictObject,
} from './CheckpointStore.js';

export type BudgetPurpose = 'development' | 'load' | 'public' | 'reserve';
export type UsageRequest = Readonly<{
  reservationId: string;
  matchId: string;
  purpose: BudgetPurpose;
  slots: 6;
  /** Per-person total connection minutes, including preparation/reconnection. */
  expectedMinutes: number;
  /** Aggregate downstream bytes for all six participants, including overhead. */
  expectedBytes: number;
  /** Fractional safety allowance, e.g. 0.2 reserves twenty percent extra. */
  margin: number;
}>;
export type UsageReservation = Readonly<{
  request: UsageRequest;
  minutes: number;
  bytes: number;
  status: 'ACTIVE' | 'RETIRING' | 'AWAITING_OFFICIAL' | 'RELEASED';
  createdAtEpochMs: number;
  retiringAtEpochMs: number | null;
  retiringAfterVersion: number | null;
  retiringPeriodId: string | null;
  remoteConfirmedAtEpochMs: number | null;
  releasedAtEpochMs: number | null;
}>;
export type UsageState = Readonly<{
  official: Readonly<{
    checkpoint: OfficialBudgetCheckpoint;
    periodId: string;
    version: number;
  }> | null;
  reservations: readonly UsageReservation[];
}>;

export function validateOfficialBudget(
  value: unknown,
  options?: { projectAlias: string; nowEpochMs: number; maxAgeMs: number },
): OfficialBudgetCheckpoint {
  const o = strictObject(value, [
    'projectAlias',
    'remainingMinutes',
    'remainingBytes',
    'checkedAtEpochMs',
    'source',
    'checkedBy',
  ]);
  if (
    !safeIdentifier(o.projectAlias) ||
    typeof o.checkedBy !== 'string' ||
    o.checkedBy.trim().length === 0 ||
    o.checkedBy.length > 128 ||
    /^(example|dummy|sample|placeholder|test|unknown)$/i.test(o.checkedBy) ||
    /^(example|dummy|sample|placeholder)$/i.test(o.projectAlias) ||
    o.source !== 'cloud-dashboard' ||
    !nonnegative(o.remainingMinutes) ||
    !Number.isSafeInteger(o.remainingBytes) ||
    !nonnegative(o.remainingBytes) ||
    !Number.isSafeInteger(o.checkedAtEpochMs) ||
    !nonnegative(o.checkedAtEpochMs) ||
    o.checkedAtEpochMs === 0
  )
    throw new Error('INVALID_OFFICIAL_BUDGET');
  if (
    options &&
    (o.projectAlias !== options.projectAlias ||
      (o.checkedAtEpochMs as number) > options.nowEpochMs ||
      options.nowEpochMs - (o.checkedAtEpochMs as number) > options.maxAgeMs)
  )
    throw new Error('OFFICIAL_BUDGET_UNCONFIRMED');
  return { ...o } as OfficialBudgetCheckpoint;
}

export function validateUsageRequest(value: unknown): UsageRequest {
  const o = strictObject(value, [
    'reservationId',
    'matchId',
    'purpose',
    'slots',
    'expectedMinutes',
    'expectedBytes',
    'margin',
  ]);
  if (
    !safeIdentifier(o.reservationId) ||
    !safeIdentifier(o.matchId) ||
    !['development', 'load', 'public', 'reserve'].includes(o.purpose as string) ||
    o.slots !== 6 ||
    !nonnegative(o.expectedMinutes) ||
    o.expectedMinutes === 0 ||
    !nonnegative(o.expectedBytes) ||
    !Number.isSafeInteger(o.expectedBytes) ||
    o.expectedBytes === 0 ||
    !nonnegative(o.margin) ||
    o.margin > 10
  )
    throw new Error('INVALID_USAGE_REQUEST');
  const request = { ...o } as UsageRequest;
  if (
    !Number.isSafeInteger(
      Math.ceil(request.slots * request.expectedMinutes * (1 + request.margin)),
    ) ||
    !Number.isSafeInteger(Math.ceil(request.expectedBytes * (1 + request.margin)))
  )
    throw new Error('USAGE_OVERFLOW');
  return request;
}

export function validateUsageState(value: unknown): UsageState {
  const o = strictObject(value, ['official', 'reservations']);
  let official: UsageState['official'] = null;
  if (o.official !== null) {
    const record = strictObject(o.official, ['checkpoint', 'periodId', 'version']);
    if (
      !safeIdentifier(record.periodId) ||
      !Number.isSafeInteger(record.version) ||
      (record.version as number) < 1
    )
      throw new Error('INVALID_OFFICIAL_VERSION');
    official = {
      checkpoint: validateOfficialBudget(record.checkpoint),
      periodId: record.periodId,
      version: record.version as number,
    };
  }
  if (!Array.isArray(o.reservations)) throw new Error('INVALID_RESERVATIONS');
  const ids = new Set<string>();
  const reservations = o.reservations.map((value): UsageReservation => {
    const record = strictObject(value, [
      'request',
      'minutes',
      'bytes',
      'status',
      'createdAtEpochMs',
      'retiringAtEpochMs',
      'retiringAfterVersion',
      'retiringPeriodId',
      'remoteConfirmedAtEpochMs',
      'releasedAtEpochMs',
    ]);
    const request = validateUsageRequest(record.request);
    if (ids.has(request.reservationId)) throw new Error('DUPLICATE_RESERVATION');
    ids.add(request.reservationId);
    if (
      !['ACTIVE', 'RETIRING', 'AWAITING_OFFICIAL', 'RELEASED'].includes(record.status as string) ||
      record.minutes !==
        Math.ceil(request.slots * request.expectedMinutes * (1 + request.margin)) ||
      record.bytes !== Math.ceil(request.expectedBytes * (1 + request.margin))
    )
      throw new Error('INVALID_RESERVATION_COST');
    for (const key of [
      'createdAtEpochMs',
      'retiringAtEpochMs',
      'retiringAfterVersion',
      'releasedAtEpochMs',
      'remoteConfirmedAtEpochMs',
    ]) {
      if (record[key] !== null && (!nonnegative(record[key]) || !Number.isSafeInteger(record[key])))
        throw new Error('INVALID_RESERVATION_TIME');
    }
    if (
      record.createdAtEpochMs === null ||
      (record.retiringPeriodId !== null && !safeIdentifier(record.retiringPeriodId))
    )
      throw new Error('INVALID_RETIREMENT_PROOF');
    if (
      record.status === 'ACTIVE' &&
      (record.retiringAtEpochMs !== null ||
        record.retiringAfterVersion !== null ||
        record.retiringPeriodId !== null ||
        record.releasedAtEpochMs !== null ||
        record.remoteConfirmedAtEpochMs !== null)
    )
      throw new Error('INVALID_ACTIVE_RESERVATION');
    if (
      record.status !== 'ACTIVE' &&
      (record.retiringAtEpochMs === null ||
        record.retiringAfterVersion === null ||
        record.retiringPeriodId === null ||
        (record.retiringAtEpochMs as number) < (record.createdAtEpochMs as number))
    )
      throw new Error('INVALID_RETIRING_RESERVATION');
    if (record.status === 'RETIRING' && record.releasedAtEpochMs !== null)
      throw new Error('INVALID_RETIRING_RESERVATION');
    if (record.status === 'RETIRING' && record.remoteConfirmedAtEpochMs !== null)
      throw new Error('INVALID_RETIRING_RESERVATION');
    if (
      (record.status === 'AWAITING_OFFICIAL' || record.status === 'RELEASED') &&
      (record.remoteConfirmedAtEpochMs === null ||
        (record.remoteConfirmedAtEpochMs as number) < (record.retiringAtEpochMs as number))
    )
      throw new Error('INVALID_REMOTE_CONFIRMATION');
    if (record.status === 'AWAITING_OFFICIAL' && record.releasedAtEpochMs !== null)
      throw new Error('INVALID_OFFICIAL_CONFIRMATION');
    if (
      record.status === 'RELEASED' &&
      (record.releasedAtEpochMs === null ||
        (record.releasedAtEpochMs as number) < (record.retiringAtEpochMs as number))
    )
      throw new Error('INVALID_RELEASED_RESERVATION');
    return { ...record, request } as UsageReservation;
  });
  if (!official && reservations.length) throw new Error('RESERVATIONS_WITHOUT_OFFICIAL_HISTORY');
  return { official, reservations };
}

export class UsageCheckpoint extends CheckpointStore<UsageState> {
  constructor(options: { opsDataDir: string; isWritable?: () => boolean }) {
    super({ ...options, fileName: 'usage-checkpoint.json', validate: validateUsageState });
  }
}

export async function readOfficialUsageInput(
  opsDataDir: string,
  options: { projectAlias: string; nowEpochMs: number; maxAgeMs: number },
): Promise<OfficialBudgetCheckpoint> {
  const filePath = operationPath(opsDataDir, 'official-usage-input.json');
  return validateOfficialBudget(
    JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown,
    options,
  );
}
