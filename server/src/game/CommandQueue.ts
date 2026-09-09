/**
 * Bounded request ledger and execution queue for accepted product commands.
 *
 * Every accepted request is exactly-once terminal: applied, rejected or canceled. Duplicates
 * replay the original receipt/outcome, pending entries are never evicted, completed entries
 * are bounded per actor (512 entries, 2 minutes) and match end cancels what is still pending.
 */
import type {
  CommandCode,
  CommandEnvelope,
  CommandOutcome,
  CommandReceipt,
  RequestStatusResult,
} from '@kkakkung/protocol/game-messages';
import type { ControlIntent, OutcomeResult } from './ports.js';

export const QUEUE_LIMITS = {
  pendingPerActor: 64,
  pendingPerRoom: 384,
  completedPerActor: 512,
  completedTtlMs: 120_000,
  heldMoveTtlMs: 500,
} as const;

export type LedgerEntry = Readonly<{
  actorId: string;
  command: CommandEnvelope;
  /** Logical game instance targeted at acceptance; null for lobby/phase-only commands. */
  gameInstanceId: string | null;
  receivedAtMs: number;
  arrivalOrdinal: number;
  receipt: CommandReceipt;
}>;

type PendingEntry = LedgerEntry & { dispatched: boolean };
type DoneEntry = Readonly<{ entry: LedgerEntry; outcome: CommandOutcome; completedAtMs: number }>;

export type AcceptResult =
  | Readonly<{ status: 'accepted'; entry: LedgerEntry; receipt: CommandReceipt }>
  | Readonly<{ status: 'duplicate'; receipt: CommandReceipt; outcome: CommandOutcome | null }>
  | Readonly<{ status: 'rejected'; code: CommandCode }>;

export type CompletedOutcome = Readonly<{ actorId: string; outcome: CommandOutcome }>;

function sameContent(a: CommandEnvelope, b: CommandEnvelope) {
  return (
    a.sequence === b.sequence &&
    a.type === b.type &&
    a.matchId === b.matchId &&
    JSON.stringify(a.payload) === JSON.stringify(b.payload)
  );
}

export class CommandQueue {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly done = new Map<string, DoneEntry>();
  private readonly doneOrder: string[] = [];
  private readonly lastSequence = new Map<string, number>();
  private readonly heldMove = new Map<
    string,
    { sequence: number; receivedAtMs: number; expired: boolean }
  >();
  private ordinal = 0;

  constructor(private readonly limits = QUEUE_LIMITS) {}

  pendingCount(actorId?: string) {
    if (actorId === undefined) return this.pending.size;
    let count = 0;
    for (const entry of this.pending.values()) if (entry.actorId === actorId) count++;
    return count;
  }

  completedCount(actorId?: string) {
    if (actorId === undefined) return this.done.size;
    let count = 0;
    for (const record of this.done.values()) if (record.entry.actorId === actorId) count++;
    return count;
  }

  /** Registers an accepted command exactly once. Limits are checked before insertion. */
  accept(input: {
    actorId: string;
    command: CommandEnvelope;
    gameInstanceId: string | null;
    nowMs: number;
    stateVersion: number;
  }): AcceptResult {
    const { actorId, command } = input;
    const existingPending = this.pending.get(command.requestId);
    const existingDone = this.done.get(command.requestId);
    const existing = existingPending ?? existingDone?.entry;
    if (existing) {
      if (existing.actorId !== actorId || !sameContent(existing.command, command))
        return { status: 'rejected', code: 'STALE_REQUEST' };
      return {
        status: 'duplicate',
        receipt: existing.receipt,
        outcome: existingDone?.outcome ?? null,
      };
    }
    const last = this.lastSequence.get(actorId);
    if (last !== undefined && command.sequence <= last)
      return { status: 'rejected', code: 'STALE_REQUEST' };
    if (this.pendingCount(actorId) >= this.limits.pendingPerActor)
      return { status: 'rejected', code: 'QUEUE_FULL' };
    if (this.pending.size >= this.limits.pendingPerRoom)
      return { status: 'rejected', code: 'QUEUE_FULL' };
    const receipt: CommandReceipt = {
      matchId: command.matchId,
      requestId: command.requestId,
      sequence: command.sequence,
      stateVersion: input.stateVersion,
      status: 'accepted',
      code: null,
    };
    const entry: PendingEntry = {
      actorId,
      command,
      gameInstanceId: input.gameInstanceId,
      receivedAtMs: input.nowMs,
      arrivalOrdinal: ++this.ordinal,
      receipt,
      dispatched: false,
    };
    this.pending.set(command.requestId, entry);
    this.lastSequence.set(actorId, command.sequence);
    return { status: 'accepted', entry, receipt };
  }

  /**
   * Freezes this tick's input: every queued (not yet dispatched) entry in arrival order.
   * Entries stay pending in the ledger until `complete` records their terminal outcome.
   */
  freeze(): LedgerEntry[] {
    const batch: PendingEntry[] = [];
    for (const entry of this.pending.values()) if (!entry.dispatched) batch.push(entry);
    batch.sort((a, b) => a.arrivalOrdinal - b.arrivalOrdinal);
    for (const entry of batch) entry.dispatched = true;
    return batch;
  }

  /** Requests still queued (never dispatched). Used to cancel before execution. */
  queued(predicate?: (entry: LedgerEntry) => boolean): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (const entry of this.pending.values())
      if (!entry.dispatched && (!predicate || predicate(entry))) out.push(entry);
    return out.sort((a, b) => a.arrivalOrdinal - b.arrivalOrdinal);
  }

  pendingEntries(predicate?: (entry: LedgerEntry) => boolean): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (const entry of this.pending.values()) if (!predicate || predicate(entry)) out.push(entry);
    return out.sort((a, b) => a.arrivalOrdinal - b.arrivalOrdinal);
  }

  isPending(requestId: string) {
    return this.pending.has(requestId);
  }

  /**
   * Records the single terminal outcome for a pending request. Returns null when the request
   * is unknown or already terminal; the original outcome is never overwritten.
   */
  complete(
    requestId: string,
    result: OutcomeResult & { tick: number },
    stateVersion: number,
    nowMs: number,
  ): CompletedOutcome | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;
    this.pending.delete(requestId);
    const base = {
      matchId: entry.command.matchId,
      requestId,
      sequence: entry.command.sequence,
      tick: result.tick,
      stateVersion,
    };
    const outcome: CommandOutcome =
      result.result === 'applied'
        ? { ...base, result: 'applied', code: null }
        : result.result === 'rejected'
          ? { ...base, result: 'rejected', code: result.code }
          : { ...base, result: 'canceled', code: result.code };
    this.done.set(requestId, { entry, outcome, completedAtMs: nowMs });
    this.doneOrder.push(requestId);
    this.trackHeldMove(entry, outcome, nowMs);
    this.pruneCompleted(nowMs);
    return { actorId: entry.actorId, outcome };
  }

  /** Cancels every pending request matching the predicate with one canceled outcome each. */
  cancelPending(
    code: CommandCode,
    tick: number,
    stateVersionFor: (actorId: string) => number,
    nowMs: number,
    predicate?: (entry: LedgerEntry) => boolean,
  ): CompletedOutcome[] {
    const outcomes: CompletedOutcome[] = [];
    for (const entry of this.pendingEntries(predicate)) {
      const completed = this.complete(
        entry.command.requestId,
        { result: 'canceled', code, tick },
        stateVersionFor(entry.actorId),
        nowMs,
      );
      if (completed) outcomes.push(completed);
    }
    return outcomes;
  }

  /** Only the authenticated actor's own ledger is visible. */
  status(actorId: string, matchId: string, requestId: string): RequestStatusResult {
    const pending = this.pending.get(requestId);
    if (pending && pending.actorId === actorId && pending.command.matchId === matchId)
      return { matchId, requestId, status: 'pending', outcome: null };
    const done = this.done.get(requestId);
    if (done && done.entry.actorId === actorId && done.entry.command.matchId === matchId)
      return { matchId, requestId, status: 'done', outcome: done.outcome };
    return { matchId, requestId, status: 'unknown', outcome: null };
  }

  /**
   * Checks the latest applied MOVE_INTENT per actor against the real clock and returns one
   * EXPIRE_MOVE control per expiry. Never re-emits for the same held move.
   */
  expireHeldMoves(nowMs: number): ControlIntent[] {
    const controls: ControlIntent[] = [];
    for (const [playerId, held] of this.heldMove) {
      if (held.expired) continue;
      if (nowMs - held.receivedAtMs > this.limits.heldMoveTtlMs) {
        held.expired = true;
        controls.push({ type: 'EXPIRE_MOVE', playerId, sequence: held.sequence });
      }
    }
    return controls;
  }

  /** Queued MOVE_INTENT entries that already expired before execution. */
  expiredQueuedMoves(nowMs: number): LedgerEntry[] {
    return this.queued(
      (entry) =>
        entry.command.type === 'MOVE_INTENT' &&
        nowMs - entry.receivedAtMs > this.limits.heldMoveTtlMs,
    );
  }

  /** Drops the held-move tracker for an actor (leave, personal end, new round). */
  forgetActor(actorId: string) {
    this.heldMove.delete(actorId);
    this.lastSequence.delete(actorId);
  }

  /** Clears everything for a new match. Pending entries must have been canceled first. */
  reset() {
    if (this.pending.size > 0) throw new Error('PENDING_NOT_TERMINAL');
    this.done.clear();
    this.doneOrder.length = 0;
    this.lastSequence.clear();
    this.heldMove.clear();
  }

  private trackHeldMove(entry: LedgerEntry, outcome: CommandOutcome, nowMs: number) {
    if (entry.command.type !== 'MOVE_INTENT' || outcome.result !== 'applied') return;
    const current = this.heldMove.get(entry.actorId);
    if (current && current.sequence > entry.command.sequence) return;
    if (entry.command.payload.direction === null) {
      this.heldMove.delete(entry.actorId);
      return;
    }
    this.heldMove.set(entry.actorId, {
      sequence: entry.command.sequence,
      receivedAtMs: Math.min(entry.receivedAtMs, nowMs),
      expired: false,
    });
  }

  pruneCompleted(nowMs: number) {
    const perActor = new Map<string, number>();
    for (const requestId of this.doneOrder) {
      const record = this.done.get(requestId);
      if (!record) continue;
      perActor.set(record.entry.actorId, (perActor.get(record.entry.actorId) ?? 0) + 1);
    }
    const kept: string[] = [];
    for (const requestId of this.doneOrder) {
      const record = this.done.get(requestId);
      if (!record) continue;
      const count = perActor.get(record.entry.actorId) ?? 0;
      const expired = nowMs - record.completedAtMs >= this.limits.completedTtlMs;
      if (expired || count > this.limits.completedPerActor) {
        this.done.delete(requestId);
        perActor.set(record.entry.actorId, count - 1);
      } else kept.push(requestId);
    }
    this.doneOrder.length = 0;
    this.doneOrder.push(...kept);
  }
}
