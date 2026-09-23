/**
 * S15P21C204-364. The LiveKit monthly participant-minute guard.
 *
 * The Build plan has a fixed monthly allowance and blocks the project once it is spent. The
 * continuous operating mode relies on that provider quota and never looks at the balance, so a
 * public service would run until LiveKit cut every live match off mid-round. This meter stops new
 * matches (never running ones) while there is still room to finish what has started.
 *
 * LiveKit's usage API is not available on this plan, so the server counts for itself: every
 * observation adds the elapsed time for each participant the media layer currently sees connected.
 * The operator supplies what the dashboard already showed (`baseline`), because the server cannot
 * know what was spent before it started counting, or by anything it does not issue. Counting only
 * moves forward and survives restarts; a new baseline replaces what was counted before it.
 *
 * The meter is a guard, not a bill: it may run slightly high, never low on purpose. The reserve
 * absorbs the difference and the matches already running when the gate closes.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export type MonthlyUsageConfig = Readonly<{
  /** Participant-minutes the plan allows per billing cycle. */
  limitMinutes: number;
  /** New matches stop once the remaining minutes are at or below this. */
  reserveMinutes: number;
  /** Minutes the dashboard showed as used at `baselineAtEpochMs`. */
  baselineMinutes: number;
  baselineAtEpochMs: number;
  /** UTC day of month the billing cycle restarts on (1-28). */
  cycleDay: number;
}>;

export type MonthlyUsageState = Readonly<{
  version: 1;
  /** Which baseline this count continues. A different baseline starts a fresh count. */
  baselineKey: string;
  cycleStartEpochMs: number;
  /** Participant-milliseconds counted since the later of the baseline and the cycle start. */
  countedMs: number;
}>;

export type MonthlyUsageStore = Readonly<{
  read(): MonthlyUsageState | null;
  write(state: MonthlyUsageState): void;
}>;

export type MonthlyUsageSnapshot = Readonly<{
  limitMinutes: number;
  reserveMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  cycleStartEpochMs: number;
  baselineAtEpochMs: number;
  /** New matches are refused. */
  blocked: boolean;
}>;

/** How often the count reaches the disk. A restart loses at most this much observation. */
const PERSIST_EVERY_MS = 30_000;

/** Start of the billing cycle containing `nowEpochMs`, in UTC. */
export function cycleStartFor(nowEpochMs: number, cycleDay: number): number {
  const now = new Date(nowEpochMs);
  const thisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), cycleDay);
  if (nowEpochMs >= thisMonth) return thisMonth;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, cycleDay);
}

function nextCycleStart(cycleStartEpochMs: number): number {
  const start = new Date(cycleStartEpochMs);
  return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
}

export function validateMonthlyUsageConfig(config: MonthlyUsageConfig): MonthlyUsageConfig {
  const whole = (value: number) => Number.isSafeInteger(value) && value >= 0;
  if (!whole(config.limitMinutes) || config.limitMinutes === 0)
    throw new Error('INVALID_MONTHLY_LIMIT');
  if (!whole(config.reserveMinutes) || config.reserveMinutes >= config.limitMinutes)
    throw new Error('INVALID_MONTHLY_RESERVE');
  if (!whole(config.baselineMinutes) || !whole(config.baselineAtEpochMs))
    throw new Error('INVALID_MONTHLY_BASELINE');
  if (!Number.isSafeInteger(config.cycleDay) || config.cycleDay < 1 || config.cycleDay > 28)
    throw new Error('INVALID_BILLING_CYCLE_DAY');
  return config;
}

export class MonthlyUsageMeter {
  private readonly config: MonthlyUsageConfig;
  private readonly baselineKey: string;
  private state: MonthlyUsageState;
  private lastObservedEpochMs: number | null = null;
  private lastPersistedEpochMs = -Infinity;
  private dirty = false;

  constructor(
    config: MonthlyUsageConfig,
    private readonly store: MonthlyUsageStore,
    private readonly nowEpochMs: () => number,
  ) {
    this.config = validateMonthlyUsageConfig(config);
    this.baselineKey = `${config.baselineMinutes}@${config.baselineAtEpochMs}`;
    const now = nowEpochMs();
    const cycleStartEpochMs = cycleStartFor(now, config.cycleDay);
    const saved = this.readSaved();
    // A saved count belongs to one baseline and one cycle. Anything else starts again from zero:
    // a new baseline already includes what the old count measured.
    this.state =
      saved &&
      saved.baselineKey === this.baselineKey &&
      saved.cycleStartEpochMs === cycleStartEpochMs
        ? saved
        : { version: 1, baselineKey: this.baselineKey, cycleStartEpochMs, countedMs: 0 };
    if (this.state !== saved) this.dirty = true;
  }

  /**
   * Adds the time since the previous observation for `connected` participants. Called from the
   * media reconcile loop, so the interval is short; the first call only starts the clock.
   */
  observe(connected: number): void {
    const now = this.nowEpochMs();
    const previous = this.lastObservedEpochMs;
    this.lastObservedEpochMs = now;
    this.rollCycle(now);
    if (previous === null || now <= previous) return;
    // Time the baseline already covers is not counted twice.
    const from = Math.max(previous, this.config.baselineAtEpochMs, this.state.cycleStartEpochMs);
    const count = Number.isSafeInteger(connected) && connected > 0 ? connected : 0;
    if (count > 0 && now > from) {
      this.state = { ...this.state, countedMs: this.state.countedMs + (now - from) * count };
      this.dirty = true;
    }
    if (this.dirty && now - this.lastPersistedEpochMs >= PERSIST_EVERY_MS) this.flush();
  }

  /** Writes the count now. Failures leave it dirty so the next observation retries. */
  flush(): void {
    if (!this.dirty) return;
    try {
      this.store.write(this.state);
      this.dirty = false;
      this.lastPersistedEpochMs = this.nowEpochMs();
    } catch {
      // The in-memory count still guards this process; the next observation retries the write.
    }
  }

  allowsNewMatch(): boolean {
    return !this.snapshot().blocked;
  }

  snapshot(): MonthlyUsageSnapshot {
    this.rollCycle(this.nowEpochMs());
    // The baseline only counts inside the cycle it was read in; a new cycle starts from zero.
    const baseline =
      this.config.baselineAtEpochMs >= this.state.cycleStartEpochMs
        ? this.config.baselineMinutes
        : 0;
    // Partial minutes round up: the guard errs towards stopping early.
    const usedMinutes = baseline + Math.ceil(this.state.countedMs / 60_000);
    const remainingMinutes = Math.max(0, this.config.limitMinutes - usedMinutes);
    return {
      limitMinutes: this.config.limitMinutes,
      reserveMinutes: this.config.reserveMinutes,
      usedMinutes,
      remainingMinutes,
      cycleStartEpochMs: this.state.cycleStartEpochMs,
      baselineAtEpochMs: this.config.baselineAtEpochMs,
      blocked: remainingMinutes <= this.config.reserveMinutes,
    };
  }

  private rollCycle(now: number): void {
    if (now < nextCycleStart(this.state.cycleStartEpochMs)) return;
    this.state = {
      version: 1,
      baselineKey: this.baselineKey,
      cycleStartEpochMs: cycleStartFor(now, this.config.cycleDay),
      countedMs: 0,
    };
    this.dirty = true;
  }

  private readSaved(): MonthlyUsageState | null {
    try {
      const saved = this.store.read();
      if (
        !saved ||
        saved.version !== 1 ||
        typeof saved.baselineKey !== 'string' ||
        !Number.isSafeInteger(saved.cycleStartEpochMs) ||
        !Number.isSafeInteger(saved.countedMs) ||
        saved.countedMs < 0
      )
        return null;
      return saved;
    } catch {
      return null;
    }
  }
}

/** The count on the operations volume, so a deploy or restart does not start it from zero. */
export function fileMonthlyUsageStore(path: string): MonthlyUsageStore {
  return {
    read() {
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, 'utf8')) as MonthlyUsageState;
    },
    write(state) {
      // Write beside the file and rename over it: a crash never leaves half a count behind.
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
    },
  };
}
