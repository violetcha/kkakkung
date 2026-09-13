import { isDeepStrictEqual } from 'node:util';
import { isImmutableSnapshot } from '../operations/ImmutableSnapshot.js';
import type { Generation } from '../media/MediaGenerationRegistry.js';
import { checksum, safeIdentifier, strictObject } from '../operations/CheckpointStore.js';
import {
  validateJournalRecord,
  type JournalEntry,
  type JournalRecord,
} from '../operations/OperationJournal.js';
import { ownsMediaRoom } from '../operations/PreviousGenerationCleanup.js';
import type { UsageReservation } from '../operations/UsageCheckpoint.js';
import {
  sameMediaOwnership,
  validateSplitMediaOwnership,
} from '../operations/SplitMediaOwnership.js';

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

/** Reuse only identical accounting inputs, never a time-limited permission or READY result. */
export class ReservationReadinessInspector {
  private previous: ReservationReadinessInput | null = null;
  private result: ReturnType<typeof inspectReservationReadiness> | null = null;

  inspect(input: ReservationReadinessInput): ReturnType<typeof inspectReservationReadiness> {
    try {
      // Deep value equality does not prove alias identity. Exemptions must still refer to the
      // exact current registry objects on EVERY call, including an otherwise identical input.
      const objects = new Set(input.generations);
      if (
        objects.size !== input.generations.length ||
        new Set(input.pendingPreparations).size !== input.pendingPreparations.length ||
        input.pendingPreparations.some((g) => !objects.has(g)) ||
        (input.pendingRetirements ?? []).some((g) => !objects.has(g))
      )
        return { consistent: false, unresolvedCount: 1 };
      if (this.result && isDeepStrictEqual(input, this.previous)) return this.result;
      const result = inspectReservationReadiness(input);
      // Own the previous values: registry state mutates in place and snapshots can be replaced
      // without advancing the journal sequence (for example, compaction or reservation changes).
      // Frozen journal/history arrays can retain identity; cloning them here would force a
      // full history comparison for every track permission check. Mutable registry objects
      // and untrusted caller arrays still get owned copies and value comparisons.
      this.previous = {
        ...structuredClone({ ...input, records: [], reservations: [] }),
        records: isImmutableSnapshot(input.records)
          ? input.records
          : structuredClone(input.records),
        reservations: isImmutableSnapshot(input.reservations)
          ? input.reservations
          : structuredClone(input.reservations),
      };
      this.result = Object.freeze(result);
      return this.result;
    } catch {
      this.previous = null;
      this.result = null;
      return { consistent: false, unresolvedCount: 1 };
    }
  }
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
    if (generation && !sameJournalGeneration(record, generation)) consistent = false;
    if (record.state !== 'REVOKED') {
      const currentPrepared =
        record.state === 'PREPARED' &&
        record.serverEpoch === input.serverEpoch &&
        generation !== undefined &&
        sameJournalGeneration(record, generation) &&
        generation.state === 'PREPARED' &&
        !generation.terminal;
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
    if (!reservationIds.has(root) && group.records.length > 0) consistent = false;
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
