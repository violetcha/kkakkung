export type ProbeRoom = Readonly<{ name: string; sid: string }>;
export type RoomSnapshot = ReadonlyMap<string, string>;
export type LifecyclePhase =
  'creation' | 'deletion' | 'stabilized-deletion' | 'recreation' | 'final';
export type LifecycleObservation = Readonly<{
  phase: LifecyclePhase;
  attempt: number;
  matched: boolean;
  newSid: boolean;
  elapsedMs: number;
}>;
export type ProbeClock = Readonly<{
  now: () => number;
  guard: () => void;
  sleep: (milliseconds: number) => Promise<void>;
}>;

/** Keep provider names/SIDs in memory; only the boolean observations below are persisted. */
export function createdRoomSnapshot(
  names: readonly string[],
  created: readonly ProbeRoom[],
  previous?: RoomSnapshot,
): RoomSnapshot {
  const expected = new Set(names);
  const snapshot = new Map<string, string>();
  const sids = new Set<string>();
  if (!names.length || expected.size !== names.length || created.length !== names.length)
    throw new Error('UNJOINED_PROBE_INVALID_ROOM_CREATION');
  for (const room of created) {
    if (!expected.has(room.name) || !room.sid || snapshot.has(room.name) || sids.has(room.sid))
      throw new Error('UNJOINED_PROBE_INVALID_ROOM_CREATION');
    if (previous && (!previous.has(room.name) || [...previous.values()].includes(room.sid)))
      throw new Error('UNJOINED_PROBE_REUSED_ROOM_SID');
    snapshot.set(room.name, room.sid);
    sids.add(room.sid);
  }
  return snapshot;
}

export function matchesRoomSnapshot(rooms: readonly ProbeRoom[], expected: RoomSnapshot): boolean {
  if (rooms.length !== expected.size) return false;
  const seen = new Set<string>();
  return rooms.every((room) => {
    if (!room.sid || seen.has(room.name) || expected.get(room.name) !== room.sid) return false;
    seen.add(room.name);
    return true;
  });
}

/** At most one second between deadline/preflight checks; no API polling during stabilization. */
export async function waitForDeletionWindow(deletedAt: number, clock: ProbeClock): Promise<void> {
  const until = deletedAt + 120_000;
  if (!Number.isFinite(deletedAt) || deletedAt > clock.now())
    throw new Error('UNJOINED_PROBE_INVALID_DELETION_CLOCK');
  while (true) {
    clock.guard();
    const remaining = until - clock.now();
    if (remaining <= 0) return;
    await clock.sleep(Math.min(1000, remaining));
  }
}

/** A bounded read-only retry cannot turn a missing/old/duplicate room into recreation proof. */
export async function confirmRoomSnapshot(options: {
  phase: LifecyclePhase;
  expected: RoomSnapshot;
  previous?: RoomSnapshot;
  read: () => Promise<readonly ProbeRoom[]>;
  clock: ProbeClock;
  record: (observation: LifecycleObservation) => void;
  attempts?: 1 | 3;
}): Promise<void> {
  const startedAt = options.clock.now();
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    options.clock.guard();
    const rooms = await options.read();
    options.clock.guard();
    const matched = matchesRoomSnapshot(rooms, options.expected);
    const newSid =
      matched &&
      options.previous !== undefined &&
      rooms.length > 0 &&
      rooms.every((room) => ![...options.previous!.values()].includes(room.sid));
    options.record({
      phase: options.phase,
      attempt,
      matched,
      newSid,
      elapsedMs: options.clock.now() - startedAt,
    });
    if (matched && (!options.previous || newSid)) return;
    if (attempt < attempts) {
      await options.clock.sleep(1000);
      options.clock.guard();
      await options.clock.sleep(1000);
    }
  }
  throw new Error(`UNJOINED_PROBE_${options.phase.toUpperCase().replaceAll('-', '_')}_UNCONFIRMED`);
}

export type ProbeTokenWindow = Readonly<{ notBeforeEpochMs: number; expiresAtEpochMs: number }>;

/** Publish acceptance only after the final independent room observation has completed. */
export async function verifyRecreatedRoomAccess(checks: {
  rejectedTokens: () => Promise<boolean>;
  connectedControls: () => Promise<boolean>;
  finalRooms: () => Promise<void>;
}): Promise<boolean> {
  const rejected = await checks.rejectedTokens();
  const connected = await checks.connectedControls();
  await checks.finalRooms();
  return rejected && connected;
}

/** Decode only our own freshly signed diagnostic JWT, never a supplied/untrusted credential. */
export function probeTokenWindow(token: string): ProbeTokenWindow {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    if (!payload || typeof payload !== 'object') throw new Error();
    const { nbf, exp } = payload as Record<string, unknown>;
    if (!Number.isSafeInteger(nbf) || !Number.isSafeInteger(exp) || Number(exp) <= Number(nbf))
      throw new Error();
    return { notBeforeEpochMs: Number(nbf) * 1000, expiresAtEpochMs: Number(exp) * 1000 };
  } catch {
    throw new Error('UNJOINED_PROBE_INVALID_TOKEN_WINDOW');
  }
}

/** An expired/not-yet-valid token's 401/403 is not revocation evidence. Check before AND after SDK. */
export function requireValidProbeToken(
  window: ProbeTokenWindow,
  now: number,
  minimumRemainingMs = 0,
): void {
  if (
    !Number.isFinite(now) ||
    now < window.notBeforeEpochMs ||
    now + minimumRemainingMs >= window.expiresAtEpochMs
  )
    throw new Error('UNJOINED_PROBE_TOKEN_WINDOW_EXCEEDED');
}
