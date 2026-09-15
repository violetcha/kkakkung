import { isDeepStrictEqual } from 'node:util';
import { isImmutableSnapshot } from '../operations/ImmutableSnapshot.js';
import type { Generation } from '../media/MediaGenerationRegistry.js';
import { checksum, safeIdentifier, strictObject } from '../operations/CheckpointStore.js';
import {
  validateJournalRecord,
  terminalJournalRecord,
  type JournalEntry,
  type JournalRecord,
} from '../operations/OperationJournal.js';
import { ownsMediaRoom } from '../operations/PreviousGenerationCleanup.js';
import type { UsageReservation } from '../operations/UsageCheckpoint.js';
import {
  sameMediaOwnership,
  validateSplitMediaOwnership,
} from '../operations/SplitMediaOwnership.js';
import {
  isEmptyReservationAbort,
  reservationIntentMatches,
} from '../operations/ReservationIntent.js';

export type ReservationReadinessInput = Readonly<{
  namespace: string;
  serverEpoch: string;
  records: readonly JournalEntry[];
  /** The caller validates the complete durable UsageState before this inspection. */
  reservations: readonly UsageReservation[];
  generations: readonly Generation[];
  /** Exact registry objects currently inside the owner's reserve/persist operation. */
  pendingPreparations: readonly Generation[];
  /** Exact current-process objects in a bounded first retirement, never retries or UNKNOWN. */
  pendingRetirements?: readonly Generation[];
}>;

const key = (value: { roomName: string; identity: string; generation: number }) =>
  JSON.stringify([value.roomName, value.identity, value.generation]);

type ReadinessResult = Readonly<{ consistent: boolean; unresolvedCount: number }>;

const fieldsOf = <T>(fields: { readonly [K in keyof T]-?: true }) =>
  Object.freeze(Object.keys(fields)) as readonly (keyof T)[];
/**
 * Every field sameGenerationValues compares. The compiler rejects these lists when a field is
 * added, and the reuse test mutates each listed field in place, so no comparison can be skipped.
 */
export const REUSED_GENERATION_FIELDS = fieldsOf<Generation>({
  request: true,
  generation: true,
  roomName: true,
  identity: true,
  serverEpoch: true,
  reservationId: true,
  issuedAtEpochMs: true,
  expiresAtEpochMs: true,
  splitOwnership: true,
  terminal: true,
  state: true,
});
export const REUSED_REQUEST_FIELDS = fieldsOf<Generation['request']>({
  requestId: true,
  matchId: true,
  playerId: true,
  mediaInstanceId: true,
  purpose: true,
  expectedPreviousGeneration: true,
});

type CachedInspection = Readonly<
  Required<ReservationReadinessInput> & {
    /** Owned copies of the generation values, index-aligned with the exact cached objects. */
    copies: readonly Generation[];
    ownerships: readonly Generation['splitOwnership'][];
    result: ReadinessResult;
  }
>;

/** Reuse only identical accounting inputs, never a time-limited permission or READY result. */
export class ReservationReadinessInspector {
  private cached: CachedInspection | null = null;

  inspect(input: ReservationReadinessInput): ReadinessResult {
    try {
      const cached = this.cached;
      const match = cached ? matchCachedInput(input, cached) : 'different';
      // Value equality does not prove alias identity. Exemptions must still refer to the
      // exact current registry objects on EVERY call, including an otherwise identical input.
      // Only the same objects in the same order carry the membership checked when cached.
      if (cached && match === 'same-objects') return cached.result;
      if (!exactMembers(input)) return { consistent: false, unresolvedCount: 1 };
      if (cached && match === 'equal-values') return cached.result;
      const result = Object.freeze(inspectReservationReadiness(input));
      // Own the previous values: registry state mutates in place and snapshots can be replaced
      // without advancing the journal sequence (for example, compaction or reservation changes).
      // Frozen journal/history arrays can retain identity; cloning them here would force a
      // full history comparison for every track permission check. Mutable registry objects
      // and untrusted caller arrays still get owned copies and value comparisons.
      this.cached = {
        namespace: input.namespace,
        serverEpoch: input.serverEpoch,
        records: isImmutableSnapshot(input.records)
          ? input.records
          : structuredClone(input.records),
        reservations: isImmutableSnapshot(input.reservations)
          ? input.reservations
          : structuredClone(input.reservations),
        generations: [...input.generations],
        pendingPreparations: [...input.pendingPreparations],
        pendingRetirements: [...(input.pendingRetirements ?? [])],
        copies: structuredClone(input.generations),
        ownerships: input.generations.map((generation) => generation.splitOwnership),
        result,
      };
      return result;
    } catch {
      this.cached = null;
      return { consistent: false, unresolvedCount: 1 };
    }
  }
}

function exactMembers(input: ReservationReadinessInput): boolean {
  const objects = new Set(input.generations);
  return (
    objects.size === input.generations.length &&
    new Set(input.pendingPreparations).size === input.pendingPreparations.length &&
    input.pendingPreparations.every((g) => objects.has(g)) &&
    (input.pendingRetirements ?? []).every((g) => objects.has(g))
  );
}

/**
 * A track permission check calls this for unchanged registry objects thousands of times per
 * second. Generic deep equality of every generation dominated server CPU, so the same object
 * compares only its typed fields with the owned copy and the other inputs keep value equality.
 */
function matchCachedInput(
  input: ReservationReadinessInput,
  cached: CachedInspection,
): 'same-objects' | 'equal-values' | 'different' {
  if (
    input.namespace !== cached.namespace ||
    input.serverEpoch !== cached.serverEpoch ||
    !sameObjects(input.pendingPreparations, cached.pendingPreparations) ||
    !sameObjects(input.pendingRetirements ?? [], cached.pendingRetirements) ||
    input.generations.length !== cached.generations.length ||
    !isDeepStrictEqual(input.records, cached.records) ||
    !isDeepStrictEqual(input.reservations, cached.reservations)
  )
    return 'different';
  let sameObjectsOnly = true;
  for (let i = 0; i < input.generations.length; i++) {
    const current = input.generations[i]!;
    if (current === cached.generations[i]) {
      if (!sameGenerationValues(current, cached.copies[i]!, cached.ownerships[i]))
        return 'different';
    } else {
      sameObjectsOnly = false;
      if (!isDeepStrictEqual(current, cached.copies[i])) return 'different';
    }
  }
  return sameObjectsOnly ? 'same-objects' : 'equal-values';
}

function sameObjects(current: readonly Generation[], cached: readonly Generation[]): boolean {
  if (current.length !== cached.length) return false;
  for (let i = 0; i < current.length; i++) if (current[i] !== cached[i]) return false;
  return true;
}

/**
 * The cached registry object may have been mutated in place since its values were copied.
 * Direct property reads keep this path cheap; a keyed loop over the field lists was 6x slower.
 */
function sameGenerationValues(
  current: Generation,
  copy: Generation,
  ownership: Generation['splitOwnership'],
): boolean {
  const request = current.request;
  if (
    current.generation !== copy.generation ||
    current.roomName !== copy.roomName ||
    current.identity !== copy.identity ||
    current.serverEpoch !== copy.serverEpoch ||
    current.reservationId !== copy.reservationId ||
    current.issuedAtEpochMs !== copy.issuedAtEpochMs ||
    current.expiresAtEpochMs !== copy.expiresAtEpochMs ||
    current.terminal !== copy.terminal ||
    current.state !== copy.state ||
    request.requestId !== copy.request.requestId ||
    request.matchId !== copy.request.matchId ||
    request.playerId !== copy.request.playerId ||
    request.mediaInstanceId !== copy.request.mediaInstanceId ||
    request.purpose !== copy.request.purpose ||
    request.expectedPreviousGeneration !== copy.request.expectedPreviousGeneration
  )
    return false;
  // Only our recursively frozen snapshot cannot change behind the same reference.
  return (
    (current.splitOwnership === ownership && isImmutableSnapshot(ownership)) ||
    isDeepStrictEqual(current.splitOwnership, copy.splitOwnership)
  );
}

function belongsToRoot(id: string, root: string): boolean {
  return id === root || (id.startsWith(`${root}:`) && /^\d+$/.test(id.slice(root.length + 1)));
}

export function sameJournalGeneration(record: JournalRecord, generation: Generation): boolean {
  return (
    key(record) === key(generation) &&
    record.serverEpoch === generation.serverEpoch &&
    record.matchId === generation.request.matchId &&
    record.mediaInstanceId === generation.request.mediaInstanceId &&
    record.reservationId === generation.reservationId &&
    record.issuedAtEpochMs === generation.issuedAtEpochMs &&
    record.expiresAtEpochMs === generation.expiresAtEpochMs &&
    sameMediaOwnership(record, generation)
  );
}

/** Pure runtime accounting inspection. It neither invents recovery proof nor changes admission. */
export function inspectReservationReadiness(
  input: ReservationReadinessInput,
): Readonly<{ consistent: boolean; unresolvedCount: number }> {
  try {
    return inspect(input);
  } catch {
    // Malformed internal observations never expose their contents or authorize issuance.
    return { consistent: false, unresolvedCount: 1 };
  }
}

function inspect(input: ReservationReadinessInput) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input.namespace) ||
    input.namespace.includes('--') ||
    !safeIdentifier(input.serverEpoch) ||
    !Array.isArray(input.records) ||
    !Array.isArray(input.reservations) ||
    !Array.isArray(input.generations) ||
    !Array.isArray(input.pendingPreparations)
  )
    throw new Error('INVALID_OBSERVATION');

  let consistent = true;
  const unresolved = new Set<string>();
  const generations = new Map<string, Generation>();
  const generationObjects = new Set(input.generations);
  const retiring = new Set(input.pendingRetirements ?? []);
  for (const generation of retiring) {
    if (
      !generationObjects.has(generation) ||
      generation.serverEpoch !== input.serverEpoch ||
      !['PREPARED', 'REVOKING', 'REVOKED'].includes(generation.state)
    )
      throw new Error('INVALID_PENDING_RETIREMENT');
  }
  if (generationObjects.size !== input.generations.length) consistent = false;
  for (const generation of input.generations) {
    if (generation.splitOwnership !== undefined)
      validateSplitMediaOwnership(generation.splitOwnership, {
        ...generation,
        namespace: input.namespace,
      });
    if (
      !ownsMediaRoom(input.namespace, generation.roomName) ||
      generation.serverEpoch !== generation.roomName.split('--')[1] ||
      generation.serverEpoch !== input.serverEpoch ||
      !safeIdentifier(generation.identity) ||
      !safeIdentifier(generation.reservationId) ||
      !safeIdentifier(generation.request.matchId) ||
      !safeIdentifier(generation.request.mediaInstanceId) ||
      !safeIdentifier(generation.request.playerId) ||
      !Number.isSafeInteger(generation.generation) ||
      generation.generation < 1 ||
      !Number.isSafeInteger(generation.issuedAtEpochMs) ||
      generation.issuedAtEpochMs < 0 ||
      !Number.isSafeInteger(generation.expiresAtEpochMs) ||
      generation.expiresAtEpochMs < generation.issuedAtEpochMs ||
      typeof generation.terminal !== 'boolean' ||
      !['PREPARED', 'REVOKING', 'REVOKED', 'UNRESOLVED'].includes(generation.state)
    )
      throw new Error('INVALID_GENERATION');
    const id = key(generation);
    if (generations.has(id)) consistent = false;
    generations.set(id, generation);
    if (
      generation.state !== 'REVOKED' &&
      !retiring.has(generation) &&
      (generation.terminal || generation.state !== 'PREPARED')
    )
      unresolved.add(id);
  }

  const pending = new Set<Generation>();
  for (const generation of input.pendingPreparations) {
    if (
      !generationObjects.has(generation) ||
      pending.has(generation) ||
      generation.serverEpoch !== input.serverEpoch ||
      generation.terminal ||
      generation.state !== 'PREPARED'
    )
      consistent = false;
    else pending.add(generation);
  }

  const records = new Map<string, JournalRecord>();
  const identities = new Set<string>();
  let previousSeq = 0;
  for (const entry of input.records) {
    strictObject(entry, ['version', 'seq', 'record', 'checksum']);
    const record = validateJournalRecord(entry.record);
    if (
      entry.version !== 1 ||
      !Number.isSafeInteger(entry.seq) ||
      entry.seq <= previousSeq ||
      entry.checksum !== checksum({ version: 1, seq: entry.seq, record }) ||
      record.namespace !== input.namespace ||
      !ownsMediaRoom(input.namespace, record.roomName) ||
      record.serverEpoch !== record.roomName.split('--')[1] ||
      !record.reservationId ||
      records.has(key(record)) ||
      identities.has(record.identity) ||
      (record.splitOwnership !== undefined && identities.has(record.splitOwnership.faceIdentity))
    )
      throw new Error('INVALID_JOURNAL_OBSERVATION');
    previousSeq = entry.seq;
    records.set(key(record), record);
    identities.add(record.identity);
    if (record.splitOwnership) identities.add(record.splitOwnership.faceIdentity);
    const generation = generations.get(key(record));
    if (!reservationIntentMatches(record, input.reservations)) consistent = false;
    if (generation && !sameJournalGeneration(record, generation)) consistent = false;
    if (!terminalJournalRecord(record)) {
      const currentPrepared =
        record.state === 'PREPARED' &&
        record.serverEpoch === input.serverEpoch &&
        generation !== undefined &&
        sameJournalGeneration(record, generation) &&
        generation.state === 'PREPARED' &&
        !generation.terminal &&
        (record.reservationIntent?.phase !== 'RESERVING' || pending.has(generation));
      const currentRetiring =
        generation !== undefined &&
        retiring.has(generation) &&
        sameJournalGeneration(record, generation) &&
        ['PREPARED', 'REVOKING'].includes(record.state);
      if (!currentPrepared && !currentRetiring) unresolved.add(key(record));
      if (record.serverEpoch === input.serverEpoch && !generation) consistent = false;
    } else if (generation && generation.state !== 'REVOKED') {
      consistent = false;
      unresolved.add(key(record));
    }
  }

  const roots = new Map<string, { matchId: string; records: JournalRecord[] }>();
  const addRoot = (root: string, matchId: string, record?: JournalRecord) => {
    const group = roots.get(root) ?? { matchId, records: [] };
    if (group.matchId !== matchId) consistent = false;
    if (record) group.records.push(record);
    roots.set(root, group);
  };
  for (const record of records.values()) addRoot(record.reservationId!, record.matchId, record);
  for (const generation of input.generations) {
    if (generation.state === 'REVOKED' && !records.has(key(generation))) continue;
    addRoot(generation.reservationId, generation.request.matchId);
    if (!records.has(key(generation)) && !pending.has(generation)) {
      consistent = false;
      unresolved.add(key(generation));
    }
  }

  const reservationIds = new Set(input.reservations.map((r) => r.request.reservationId));
  if (reservationIds.size !== input.reservations.length) consistent = false;
  for (const [root, group] of roots) {
    // A pending preparation may be inspected before its very first reserve reaches disk.
    if (
      !reservationIds.has(root) &&
      group.records.length > 0 &&
      !group.records.every(
        (record) =>
          isEmptyReservationAbort(record, input.reservations) ||
          (record.state === 'PREPARED' &&
            record.reservationIntent?.phase === 'RESERVING' &&
            [...pending].some((generation) => sameJournalGeneration(record, generation))),
      )
    )
      consistent = false;
  }
  for (const reservation of input.reservations) {
    const id = reservation.request.reservationId;
    const candidates = [...roots].filter(([root]) => belongsToRoot(id, root));
    if (candidates.length !== 1) {
      if (reservation.status !== 'RELEASED' || candidates.length > 1) consistent = false;
      if (reservation.status === 'RETIRING') unresolved.add(`reservation:${id}`);
      continue;
    }
    const [root, group] = candidates[0]!;
    if (reservation.request.matchId !== group.matchId || !reservationIds.has(root))
      consistent = false;
    if (
      (reservation.status === 'RELEASED' || reservation.status === 'AWAITING_OFFICIAL') &&
      (group.records.some((record) => record.state !== 'REVOKED') ||
        input.generations.some(
          (generation) => generation.reservationId === root && generation.state !== 'REVOKED',
        ))
    )
      consistent = false;
    if (group.records.length === 0 && reservation.status !== 'RELEASED') {
      const transient =
        reservation.status === 'ACTIVE' &&
        [...pending].some(
          (generation) =>
            generation.reservationId === root &&
            generation.request.matchId === reservation.request.matchId,
        );
      if (!transient) consistent = false;
    }
    if (
      reservation.status === 'RETIRING' &&
      !(
        [...retiring].some((g) => g.reservationId === root) &&
        group.records.every(
          (record) =>
            record.state === 'REVOKED' ||
            [...retiring].some(
              (g) =>
                sameJournalGeneration(record, g) && ['PREPARED', 'REVOKING'].includes(record.state),
            ),
        ) &&
        input.generations
          .filter((g) => g.reservationId === root)
          .every((g) => g.state === 'REVOKED' || retiring.has(g))
      ) &&
      !group.records.some((record) => unresolved.has(key(record))) &&
      !input.generations.some(
        (generation) => generation.reservationId === root && unresolved.has(key(generation)),
      )
    )
      unresolved.add(`reservation:${root}`);
  }
  return { consistent, unresolvedCount: unresolved.size };
}
