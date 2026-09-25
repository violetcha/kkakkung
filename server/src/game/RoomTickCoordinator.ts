/**
 * Process-wide fair tick coordinator for product rooms. Each room keeps a monotonic `nextDue`;
 * lag L = max(0, now - nextDue) is re-measured right before every execution. Late rooms catch up
 * at most 4 rounds per run and then the coordinator yields to the event loop, so the room's tick
 * count keeps following the wall clock the web synchronises to.
 *
 * S15P21C204-389. A lag past 250ms is a stall, not yet an overload: one GC pause or CPU spike
 * used to void the whole round. A stall is counted once until the lag drops back under 250ms and
 * the room keeps catching up. Only a lag past 1,000ms, or a third stall within 10s, is an
 * overload: the room is not replayed, its overload callback fires once and it must abort via
 * the ABORT_MATCH control. Observability is emitted through the injected
 * F-owned callback; the coordinator never performs IO itself. A tick that throws is contained:
 * `run()` never propagates it, the failing room is not replayed until it re-arms, and every
 * other room in the rotation still ticks. The overload callback is contained the same way: it
 * aborts a match, and a throw there used to leave the 10ms interval and end the process (336).
 */
import type { EmitMetric } from './ports.js';

export type TickCallbacks = Readonly<{
  onTick: (lagMs: number, tickNumber: number) => void;
  onOverload: (lagMs: number) => void;
  /** A tick that threw. Like an overload the room is not replayed until it re-arms. */
  onTickFailed?: (error: unknown) => void;
}>;

type Registration = TickCallbacks & {
  id: string;
  nextDue: number;
  executed: number;
  overloaded: boolean;
  /** Inside a stall: counted once, until the lag drops back under `overloadMs`. */
  stalling: boolean;
  /** When recent stalls began, pruned to `stallWindowMs`. */
  stalls: number[];
};

export type CoordinatorOptions = Readonly<{
  now: () => number;
  tickMs?: number;
  /** Lag that starts a stall (default 250ms). */
  overloadMs?: number;
  /** Lag that is an overload at once (default 1,000ms). */
  abortLagMs?: number;
  /** Stalls within `stallWindowMs` that make an overload (default 3 in 10,000ms). */
  stallLimit?: number;
  stallWindowMs?: number;
  maxRoundsPerRun?: number;
  emitMetric?: EmitMetric;
  /** Diagnostics for a thrown tick. The coordinator itself performs no IO. */
  onTickError?: (id: string, error: unknown) => void;
}>;

export class RoomTickCoordinator {
  private readonly rooms = new Map<string, Registration>();
  private rotation = 0;
  readonly tickMs: number;
  readonly overloadMs: number;
  readonly abortLagMs: number;
  readonly stallLimit: number;
  readonly stallWindowMs: number;
  readonly maxRoundsPerRun: number;

  constructor(private readonly options: CoordinatorOptions) {
    this.tickMs = options.tickMs ?? 50;
    this.overloadMs = options.overloadMs ?? 250;
    this.abortLagMs = options.abortLagMs ?? 1000;
    this.stallLimit = options.stallLimit ?? 3;
    this.stallWindowMs = options.stallWindowMs ?? 10_000;
    this.maxRoundsPerRun = options.maxRoundsPerRun ?? 4;
  }

  register(id: string, callbacks: TickCallbacks) {
    if (this.rooms.has(id)) throw new Error('ROOM_ALREADY_REGISTERED');
    this.rooms.set(id, {
      id,
      ...callbacks,
      nextDue: this.options.now() + this.tickMs,
      executed: 0,
      overloaded: false,
      stalling: false,
      stalls: [],
    });
  }

  unregister(id: string) {
    this.rooms.delete(id);
  }

  get size() {
    return this.rooms.size;
  }

  lagOf(id: string): number | null {
    const room = this.rooms.get(id);
    return room ? Math.max(0, this.options.now() - room.nextDue) : null;
  }

  /**
   * Runs every due room in rotating order for at most `maxRoundsPerRun` rounds. Returns how
   * many ticks executed and whether work remained (the caller should schedule another run).
   */
  run(): { executed: number; yielded: boolean; overloaded: string[]; failed: string[] } {
    const runAt = this.options.now();
    const overloaded: string[] = [];
    const failed: string[] = [];
    let executed = 0;
    let pending = false;
    const ids = [...this.rooms.keys()];
    if (ids.length === 0) return { executed, yielded: false, overloaded, failed };
    const start = this.rotation % ids.length;
    this.rotation = (this.rotation + 1) % ids.length;
    const order = [...ids.slice(start), ...ids.slice(0, start)];
    for (let round = 0; round < this.maxRoundsPerRun; round++) {
      let any = false;
      for (const id of order) {
        const room = this.rooms.get(id);
        if (!room || room.overloaded) continue;
        const now = this.options.now();
        const lag = now - room.nextDue;
        if (lag < 0) continue;
        if (lag > this.overloadMs && !room.stalling) {
          room.stalling = true;
          room.stalls = room.stalls.filter((at) => now - at < this.stallWindowMs);
          room.stalls.push(now);
        } else if (lag <= this.overloadMs) room.stalling = false;
        if (
          lag > this.overloadMs &&
          (lag > this.abortLagMs || room.stalls.length >= this.stallLimit)
        ) {
          room.overloaded = true;
          room.nextDue = now;
          overloaded.push(id);
          this.emit('tick.overload', 1, 'count', now, id);
          this.emit('eventLoop.lag', lag, 'ms', now, id);
          try {
            room.onOverload(lag);
          } catch (error) {
            // The room is already stopped; a failed overload goes the way of a failed tick.
            failed.push(id);
            this.options.onTickError?.(id, error);
            this.notifyFailure(room, error);
          }
          continue;
        }
        room.executed += 1;
        room.nextDue += this.tickMs;
        executed += 1;
        any = true;
        this.emit('tick.due', 1, 'count', now, id);
        this.emit('eventLoop.lag', lag, 'ms', now, id);
        if (round > 0) this.emit('tick.catchup', 1, 'count', now, id);
        const startedAt = this.options.now();
        try {
          room.onTick(lag, room.executed);
        } catch (error) {
          // One room's failure never stops the rotation nor the process. The room stops here
          // and its own callback decides how to abort; `run()` reports it and continues.
          room.overloaded = true;
          room.nextDue = now;
          failed.push(id);
          this.emit('tick.overload', 1, 'count', now, id);
          this.options.onTickError?.(id, error);
          this.notifyFailure(room, error);
        } finally {
          this.emit('tick.duration', Math.max(0, this.options.now() - startedAt), 'ms', runAt, id);
        }
      }
      if (!any) break;
    }
    for (const room of this.rooms.values())
      if (!room.overloaded && this.options.now() >= room.nextDue) pending = true;
    return { executed, yielded: pending, overloaded, failed };
  }

  /** Re-arms an overloaded registration for a new match; the previous match stays aborted. */
  rearm(id: string) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.overloaded = false;
    room.stalling = false;
    room.stalls = [];
    room.nextDue = this.options.now() + this.tickMs;
  }

  private notifyFailure(room: Registration, error: unknown) {
    try {
      room.onTickFailed?.(error);
    } catch {
      // A failing failure handler must not break the tick path either.
    }
  }

  private emit(name: string, value: number, unit: 'count' | 'ms', atMs: number, matchRef: string) {
    try {
      this.options.emitMetric?.({ name, value, unit, atMs, matchRef });
    } catch {
      // Observability never breaks the tick path.
    }
  }
}
