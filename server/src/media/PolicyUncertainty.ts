export type PolicyTimer = (callback: () => void, delayMs: number) => () => void;
export const nodePolicyTimer: PolicyTimer = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
};

/** A one-way latch; local cancellation never claims remote cancellation. */
export class PolicyUncertainty {
  private requestDeadline: number | null = null;
  private securityDeadline: number | null = null;
  private cancelTimer: (() => void) | null = null;
  private terminal = false;

  constructor(
    private readonly now: () => number,
    private readonly onUnknown: (
      reason: 'REQUEST_FAILED' | 'RESPONSE_TIMEOUT' | 'BLOCK_TIMEOUT',
    ) => void,
    private readonly timer: PolicyTimer = nodePolicyTimer,
  ) {}

  sent(atMs: number, responseTimeoutMs = 1000): void {
    this.requestDeadline = atMs + responseTimeoutMs;
    this.arm();
  }
  responded(): void {
    this.check();
    this.requestDeadline = null;
    this.arm();
  }
  requireBlock(generatedAtMs: number): void {
    this.securityDeadline = Math.min(this.securityDeadline ?? Infinity, generatedAtMs + 1000);
    this.arm();
  }
  blockConfirmed(): void {
    this.securityDeadline = null;
    this.arm();
  }
  fail(reason: 'REQUEST_FAILED' | 'RESPONSE_TIMEOUT' | 'BLOCK_TIMEOUT' = 'REQUEST_FAILED'): void {
    if (this.terminal) return;
    this.terminal = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.onUnknown(reason);
  }
  check(): void {
    if (!this.terminal && this.now() >= this.deadline())
      this.fail(
        (this.securityDeadline ?? Infinity) <= (this.requestDeadline ?? Infinity)
          ? 'BLOCK_TIMEOUT'
          : 'RESPONSE_TIMEOUT',
      );
  }
  isTerminal(): boolean {
    return this.terminal;
  }
  dispose(): void {
    this.terminal = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
  private deadline(): number {
    return Math.min(this.requestDeadline ?? Infinity, this.securityDeadline ?? Infinity);
  }
  private arm(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.check();
    const deadline = this.deadline();
    if (!this.terminal && Number.isFinite(deadline)) {
      this.cancelTimer = this.timer(
        () => this.arm(),
        Math.max(1, Math.ceil(deadline - this.now())),
      );
    }
  }
}
