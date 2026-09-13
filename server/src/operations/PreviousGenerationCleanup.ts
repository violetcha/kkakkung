import { checksum, safeIdentifier, strictObject } from './CheckpointStore.js';
import {
  validateJournalRecord,
  type JournalEntry,
  type JournalRecord,
} from './OperationJournal.js';
import type { CleanupInput, CleanupReport } from './RecoveryState.js';

export type { CleanupInput, CleanupReport } from './RecoveryState.js';
export type CleanupTarget = Readonly<{
  roomName: string;
  identity: string;
  record: JournalRecord | null;
}>;
export type CleanupCallContext = Readonly<{
  signal?: AbortSignal;
  beforeDispatch: () => boolean;
}>;
export type CleanupObservedTarget = Readonly<{ roomName: string; identity: string }>;
export type CleanupRunInput = CleanupInput &
  Readonly<{
    serverEpoch?: string;
    signal?: AbortSignal;
    beforeDispatch?: () => boolean;
    observedTargets?: readonly CleanupObservedTarget[];
  }>;

const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const validEpoch = (value: string) => new RegExp(`^${uuid}$`).test(value);
const validNamespace = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) && !value.includes('--');

export function ownsMediaRoom(namespace: string, roomName: string): boolean {
  return (
    validNamespace(namespace) &&
    typeof roomName === 'string' &&
    new RegExp(`^${namespace}--${uuid}--${uuid}$`).test(roomName)
  );
}

function recordKey(record: JournalRecord): string {
  return JSON.stringify([record.namespace, record.roomName, record.identity, record.generation]);
}

function remoteKey(roomName: string, identity: string): string {
  return JSON.stringify([roomName, identity]);
}

function replay(records: readonly JournalEntry[], namespace: string): readonly JournalRecord[] {
  if (!Array.isArray(records)) throw new Error('INVALID_CLEANUP_RECORDS');
  const latest = new Map<string, JournalRecord>();
  let previousSeq = 0;
  for (const entry of records) {
    strictObject(entry, ['version', 'seq', 'record', 'checksum']);
    const record = validateJournalRecord(entry.record);
    if (
      entry.version !== 1 ||
      !Number.isSafeInteger(entry.seq) ||
      entry.seq <= previousSeq ||
      entry.checksum !== checksum({ version: 1, seq: entry.seq, record }) ||
      record.namespace !== namespace ||
      !ownsMediaRoom(namespace, record.roomName) ||
      record.serverEpoch !== record.roomName.split('--')[1]
    )
      throw new Error('INVALID_CLEANUP_RECORDS');
    previousSeq = entry.seq;
    const key = recordKey(record);
    const previous = latest.get(key);
    if (
      previous &&
      (previous.matchId !== record.matchId ||
        previous.mediaInstanceId !== record.mediaInstanceId ||
        previous.serverEpoch !== record.serverEpoch ||
        previous.reservationId !== record.reservationId ||
        previous.issuedAtEpochMs !== record.issuedAtEpochMs ||
        previous.expiresAtEpochMs !== record.expiresAtEpochMs ||
        (previous.state === 'REVOKED' && record.state !== 'REVOKED'))
    )
      throw new Error('INVALID_CLEANUP_RECORDS');
    latest.set(key, structuredClone(record));
  }
  return [...latest.values()];
}

/** Every callback must use the shared gateway budget and honor context at actual dispatch. */
export class PreviousGenerationCleanup {
  private active: Promise<CleanupReport> | null = null;

  constructor(
    private readonly options: Readonly<{
      namespace: string;
      listRooms: (context: CleanupCallContext) => Promise<readonly { name: string }[]>;
      listParticipants: (
        roomName: string,
        context: CleanupCallContext,
      ) => Promise<readonly { identity: string }[]>;
      revoke: (target: CleanupTarget, context: CleanupCallContext) => Promise<boolean>;
      deleteRoom: (roomName: string, context: CleanupCallContext) => Promise<unknown>;
      checkpoint: (report: CleanupReport, context: CleanupCallContext) => Promise<void>;
      onUnresolved?: (report: CleanupReport) => void;
    }>,
  ) {
    if (!validNamespace(options.namespace)) throw new Error('INVALID_NAMESPACE');
  }

  /** Concurrent passes cannot race deletion; an explicit later pass may retry unresolved work. */
  run(input: CleanupRunInput): Promise<CleanupReport> {
    if (this.active) return Promise.reject(new Error('CLEANUP_IN_PROGRESS'));
    const captured = {
      ...input,
      records: structuredClone(input.records),
      observedTargets: structuredClone(input.observedTargets),
    };
    const work = this.runOnce(captured);
    this.active = work;
    void work
      .finally(() => {
        if (this.active === work) this.active = null;
      })
      .catch(() => {});
    return work;
  }

  private async runOnce(input: CleanupRunInput): Promise<CleanupReport> {
    let historyComplete = input.historyComplete === true;
    let recordedIdentities = 0;
    let observedParticipants = 0;
    let revoked = 0;
    let unresolved = 0;
    let remaining = 0;
    const namespace = this.options.namespace;
    const guard = () => {
      try {
        return (
          input.singleWriter === true &&
          input.signal?.aborted !== true &&
          (input.beforeDispatch === undefined || input.beforeDispatch() === true)
        );
      } catch {
        return false;
      }
    };
    const context: CleanupCallContext = Object.freeze({
      signal: input.signal,
      beforeDispatch: guard,
    });
    const assertCurrent = () => {
      if (!guard()) throw new Error('CLEANUP_STOPPED');
    };
    const checked = async <T>(call: () => Promise<T>): Promise<T> => {
      assertCurrent();
      try {
        const result = await call();
        assertCurrent();
        return result;
      } catch (error) {
        assertCurrent();
        throw error;
      }
    };
    // Keep every historical-room check, but bound network latency and queue size.
    // All workers settle before crossing a phase boundary or releasing this sweep.
    const forEachRoom = async (
      names: ReadonlySet<string>,
      visit: (roomName: string) => Promise<void>,
    ): Promise<void> => {
      const iterator = names.values();
      const worker = async () => {
        for (;;) {
          assertCurrent();
          const next = iterator.next();
          if (next.done) return;
          await visit(next.value);
        }
      };
      const settled = await Promise.allSettled(
        Array.from({ length: Math.min(4, names.size) }, worker),
      );
      const failed = settled.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      assertCurrent();
    };
    const report = (): CleanupReport => ({
      recordedIdentities,
      observedParticipants,
      revoked,
      unresolved,
      ownedRoomsRemaining: remaining,
      historyComplete,
    });
    const finish = (): CleanupReport => {
      const result = Object.freeze(report());
      if (result.unresolved > 0 || result.ownedRoomsRemaining > 0 || !result.historyComplete) {
        try {
          this.options.onUnresolved?.(result);
        } catch {
          // Notification failure cannot change durable evidence or permit admission.
        }
      }
      return result;
    };
    try {
      assertCurrent();
      if (
        typeof input.historyComplete !== 'boolean' ||
        (input.serverEpoch !== undefined && !validEpoch(input.serverEpoch))
      )
        throw new Error('INVALID_CLEANUP_INPUT');
      const records = replay(input.records, namespace);
      const targets = new Map<string, CleanupTarget>();
      const recordedRooms = new Set(records.map((record) => record.roomName));
      const rooms = new Set<string>();
      const failedRooms = new Set<string>();
      const ambiguousRooms = new Set<string>();
      const byRemote = new Map<string, JournalRecord[]>();
      const safeRoom = (name: string): boolean => {
        if (
          !ownsMediaRoom(namespace, name) ||
          (input.serverEpoch !== undefined &&
            name.split('--')[1]!.toLowerCase() === input.serverEpoch.toLowerCase())
        ) {
          if (typeof name === 'string' && name.startsWith(`${namespace}--`)) {
            historyComplete = false;
            if (!ambiguousRooms.has(name)) unresolved++;
            ambiguousRooms.add(name);
          }
          return false;
        }
        return true;
      };
      for (const record of records) {
        if (!safeRoom(record.roomName)) continue;
        rooms.add(record.roomName);
        const key = remoteKey(record.roomName, record.identity);
        byRemote.set(key, [...(byRemote.get(key) ?? []), record]);
        if (record.state !== 'REVOKED') {
          targets.set(recordKey(record), {
            roomName: record.roomName,
            identity: record.identity,
            record,
          });
        }
      }
      recordedIdentities = targets.size;

      if (input.observedTargets !== undefined) {
        if (!Array.isArray(input.observedTargets)) throw new Error('INVALID_OBSERVED_TARGETS');
        for (const target of input.observedTargets) {
          strictObject(target, ['roomName', 'identity']);
          if (!safeIdentifier(target.identity) || !ownsMediaRoom(namespace, target.roomName))
            throw new Error('INVALID_OBSERVED_TARGETS');
          historyComplete = false;
          if (!safeRoom(target.roomName)) continue;
          rooms.add(target.roomName);
          const key = remoteKey(target.roomName, target.identity);
          const known = byRemote.get(key);
          if (known) {
            for (const record of known) targets.set(recordKey(record), { ...target, record });
          } else targets.set(key, { ...target, record: null });
        }
      }

      let receivedRoomList = false;
      try {
        const listed = await checked(() => this.options.listRooms(context));
        receivedRoomList = true;
        if (!Array.isArray(listed)) throw new Error('INVALID_ROOM_LIST');
        for (const room of listed) {
          if (!room || typeof room.name !== 'string') throw new Error('INVALID_ROOM_LIST');
          if (!safeRoom(room.name)) continue;
          rooms.add(room.name);
          if (!recordedRooms.has(room.name)) historyComplete = false;
        }
      } catch {
        assertCurrent();
        unresolved++;
        // A failed transport leaves the remote observation unresolved. It does not prove
        // that the verified local history is missing. Invalid returned data still does.
        if (receivedRoomList) historyComplete = false;
      }
      remaining = rooms.size;
      // Recorded-only rooms also need participant enumeration: the global list is not exhaustive proof.
      await forEachRoom(rooms, async (roomName) => {
        try {
          const participants = await checked(() =>
            this.options.listParticipants(roomName, context),
          );
          if (!Array.isArray(participants)) throw new Error('INVALID_PARTICIPANT_LIST');
          const observed = new Set<string>();
          for (const participant of participants) {
            if (!participant || !safeIdentifier(participant.identity))
              throw new Error('INVALID_PARTICIPANT_LIST');
            if (observed.has(participant.identity)) continue;
            observed.add(participant.identity);
            observedParticipants++;
            const key = remoteKey(roomName, participant.identity);
            const recorded = byRemote.get(key);
            if (recorded) {
              for (const record of recorded) {
                // Reappearance invalidates a previous REVOKED confirmation.
                targets.set(recordKey(record), {
                  roomName,
                  identity: participant.identity,
                  record,
                });
              }
            } else {
              historyComplete = false;
              targets.set(key, { roomName, identity: participant.identity, record: null });
            }
          }
        } catch {
          assertCurrent();
          unresolved++;
          failedRooms.add(roomName);
        }
      });
      for (const target of targets.values()) {
        try {
          if ((await checked(() => this.options.revoke(Object.freeze(target), context))) === true) {
            revoked++;
          } else {
            unresolved++;
            failedRooms.add(target.roomName);
          }
        } catch {
          assertCurrent();
          unresolved++;
          failedRooms.add(target.roomName);
        }
      }
      await forEachRoom(rooms, async (roomName) => {
        if (failedRooms.has(roomName)) return;
        try {
          await checked(() => this.options.deleteRoom(roomName, context));
        } catch {
          assertCurrent();
          unresolved++;
          failedRooms.add(roomName);
        }
      });

      const finalRooms = new Set<string>();
      let receivedFinalRoomList = false;
      try {
        const listed = await checked(() => this.options.listRooms(context));
        receivedFinalRoomList = true;
        if (!Array.isArray(listed)) throw new Error('INVALID_ROOM_LIST');
        const owned = new Set<string>();
        for (const room of listed) {
          if (!room || typeof room.name !== 'string') throw new Error('INVALID_ROOM_LIST');
          if (ownsMediaRoom(namespace, room.name)) owned.add(room.name);
          if (!safeRoom(room.name)) continue;
          finalRooms.add(room.name);
          if (!rooms.has(room.name) || !recordedRooms.has(room.name)) historyComplete = false;
        }
        remaining = owned.size;
        unresolved += remaining;
      } catch {
        assertCurrent();
        unresolved++;
        if (receivedFinalRoomList) historyComplete = false;
      }
      // Verify every known target after deletion, including rooms omitted from the final global list.
      await forEachRoom(new Set([...rooms, ...finalRooms]), async (roomName) => {
        try {
          const participants = await checked(() =>
            this.options.listParticipants(roomName, context),
          );
          if (!Array.isArray(participants)) throw new Error('INVALID_PARTICIPANT_LIST');
          const identities = new Set<string>();
          for (const participant of participants) {
            if (!participant || !safeIdentifier(participant.identity))
              throw new Error('INVALID_PARTICIPANT_LIST');
            identities.add(participant.identity);
            if (!byRemote.has(remoteKey(roomName, participant.identity))) historyComplete = false;
          }
          if (identities.size > 0) unresolved += identities.size;
        } catch {
          assertCurrent();
          unresolved++;
        }
      });
      try {
        await checked(() => this.options.checkpoint(Object.freeze(report()), context));
      } catch {
        assertCurrent();
        unresolved++;
        historyComplete = false;
      }
      return finish();
    } catch {
      // Failed ownership/input validation or cancellation never writes a success checkpoint.
      unresolved = Math.max(1, unresolved);
      historyComplete = false;
      return finish();
    }
  }
}
