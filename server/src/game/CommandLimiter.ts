/** Per-connection token bucket: 30 refills per second, capacity 60. Time is injected. */
export type TokenBucketOptions = Readonly<{ capacity?: number; refillPerSecond?: number }>;

export class TokenBucket {
  private tokens: number;
  private lastMs: number | null = null;
  readonly capacity: number;
  readonly refillPerSecond: number;

  constructor(options: TokenBucketOptions = {}) {
    this.capacity = options.capacity ?? 60;
    this.refillPerSecond = options.refillPerSecond ?? 30;
    if (this.capacity <= 0 || this.refillPerSecond <= 0) throw new Error('INVALID_BUCKET');
    this.tokens = this.capacity;
  }

  available(nowMs: number): number {
    this.refill(nowMs);
    return this.tokens;
  }

  tryTake(nowMs: number): boolean {
    this.refill(nowMs);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(nowMs: number) {
    if (!Number.isFinite(nowMs)) throw new Error('INVALID_TIME');
    if (this.lastMs === null) {
      this.lastMs = nowMs;
      return;
    }
    const elapsed = Math.max(0, nowMs - this.lastMs);
    this.lastMs = Math.max(this.lastMs, nowMs);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.refillPerSecond);
  }
}

export class CommandLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  constructor(private readonly options: TokenBucketOptions = {}) {}

  /** Returns true when the connection may submit one more command now. */
  allow(connectionId: string, nowMs: number): boolean {
    let bucket = this.buckets.get(connectionId);
    if (!bucket) {
      bucket = new TokenBucket(this.options);
      this.buckets.set(connectionId, bucket);
    }
    return bucket.tryTake(nowMs);
  }

  forget(connectionId: string) {
    this.buckets.delete(connectionId);
  }

  get size() {
    return this.buckets.size;
  }
}
