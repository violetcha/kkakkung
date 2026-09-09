/**
 * Common start time. Once the loading barrier passes, the server picks startAt = now + 3000ms
 * (monotonic) exactly once per loadId; duplicate readiness never moves it. When the deadline
 * tick arrives the room hands one START_PLAYING control to the core in its serial boundary.
 */
export const COUNTDOWN_MS = 3000;

export class CountdownCoordinator {
  private loadId: string | null = null;
  private startAtMs: number | null = null;
  private fired = false;

  constructor(private readonly options: { durationMs?: number } = {}) {}

  get durationMs() {
    return this.options.durationMs ?? COUNTDOWN_MS;
  }

  get startAt() {
    return this.startAtMs;
  }

  get armed() {
    return this.startAtMs !== null && !this.fired;
  }

  /** Arms once per loadId. Returns the startAt or null when a countdown already exists. */
  arm(loadId: string, nowMs: number): number | null {
    if (this.loadId === loadId && this.startAtMs !== null) return null;
    this.loadId = loadId;
    this.startAtMs = nowMs + this.durationMs;
    this.fired = false;
    return this.startAtMs;
  }

  /** True exactly once, when the start time is reached. */
  due(nowMs: number): boolean {
    if (this.startAtMs === null || this.fired || nowMs < this.startAtMs) return false;
    this.fired = true;
    return true;
  }

  cancel() {
    this.loadId = null;
    this.startAtMs = null;
    this.fired = false;
  }
}
