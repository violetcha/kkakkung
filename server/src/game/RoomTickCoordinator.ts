/**
 * Process-wide fair tick coordinator for product rooms. Each room keeps a monotonic `nextDue`;
 * lag L = max(0, now - nextDue) is re-measured right before every execution. A room whose lag
 * exceeds 250ms is not replayed: its overload callback fires once and it must abort via the
 * ABORT_MATCH control. Rooms that are merely late catch up at most 4 rounds per run and then
 * the coordinator yields to the event loop. Observability is emitted through the injected
 * F-owned callback; the coordinator never performs IO itself.
 */
import type { EmitMetric } from './ports.js';

export type TickCallbacks = Readonly<{
  onTick: (lagMs: number, tickNumber: number) => void;
  onOverload: (lagMs: number) => void;
}>;

type Registration = TickCallbacks & {
  id: string;
  nextDue: number;
  executed: number;
  overloaded: boolean;
};

export type CoordinatorOptions = Readonly<{
  now: () => number;
  tickMs?: number;
  overloadMs?: number;
  maxRoundsPerRun?: number;
  emitMetric?: EmitMetric;
}>;

export class RoomTickCoordinator {
  private readonly rooms = new Map<string, Registration>();
  private rotation = 0;
  readonly tickMs: number;
  readonly overloadMs: number;
  readonly maxRoundsPerRun: number;

  constructor(private readonly options: CoordinatorOptions) {
    this.tickMs = options.tickMs ?? 50;
    this.overloadMs = options.overloadMs ?? 250;
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
  run(): { executed: number; yielded: boolean; overloaded: string[] } {
    const overloaded: string[] = [];
    let executed = 0;
    let pending = false;
    const ids = [...this.rooms.keys()];
    if (ids.length === 0) return { executed, yielded: false, overloaded };
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
        if (lag > this.overloadMs) {
          room.overloaded = true;
          room.nextDue = now;
          overloaded.push(id);
          this.emit('tick.overload', 1, 'count', now, id);
          this.emit('eventLoop.lag', lag, 'ms', now, id);
          room.onOverload(lag);
          continue;
        }
        room.executed += 1;
        room.nextDue += this.tickMs;
        executed += 1;
        any = true;
        this.emit('tick.due', 1, 'count', now, id);
        this.emit('eventLoop.lag', lag, 'ms', now, id);
        if (round > 0) this.emit('tick.catchup', 1, 'count', now, id);
        room.onTick(lag, room.executed);
      }
      if (!any) break;
    }
    for (const room of this.rooms.values())
      if (!room.overloaded && this.options.now() >= room.nextDue) pending = true;
    return { executed, yielded: pending, overloaded };
  }

  /** Re-arms an overloaded registration for a new match; the previous match stays aborted. */
  rearm(id: string) {
    const room = this.rooms.get(id);
    if (!room) return;
    room.overloaded = false;
    room.nextDue = this.options.now() + this.tickMs;
  }

  private emit(name: string, value: number, unit: 'count' | 'ms', atMs: number, matchRef: string) {
    try {
      this.options.emitMetric?.({ name, value, unit, atMs, matchRef });
    } catch {
      // Observability never breaks the tick path.
    }
  }
}
