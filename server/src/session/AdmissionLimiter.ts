/**
 * Session attempt limiter: invitation-first, with a secondary per-IP bucket sized for school
 * NAT sharing. All three values are required positive safe integers from F configuration;
 * no default rate is invented here.
 */
export type AdmissionLimiterOptions = Readonly<{
  windowMs: number;
  perInvite: number;
  perIp: number;
  /** Memory ceiling per dimension; full live buckets are never evicted to admit new keys. */
  maxKeys?: number;
}>;

export type AdmissionVerdict = 'allowed' | 'invite' | 'ip';

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export class AdmissionLimiter {
  private readonly invites = new Map<string, number[]>();
  private readonly ips = new Map<string, number[]>();
  private readonly maxKeys: number;
  private nextSweepMs = Number.NEGATIVE_INFINITY;

  constructor(readonly options: AdmissionLimiterOptions) {
    if (
      !positiveSafeInteger(options.windowMs) ||
      !positiveSafeInteger(options.perInvite) ||
      !positiveSafeInteger(options.perIp) ||
      (options.maxKeys !== undefined && !positiveSafeInteger(options.maxKeys))
    )
      throw new Error('INVALID_ADMISSION_LIMITS');
    this.maxKeys = options.maxKeys ?? 4096;
  }

  /** Records the attempt and reports which bucket, if any, refuses it. Invite is checked first. */
  attempt(input: { inviteId: string; ip: string | null }, nowMs: number): AdmissionVerdict {
    if (!Number.isFinite(nowMs)) return 'invite';
    if (nowMs >= this.nextSweepMs) {
      for (const map of [this.invites, this.ips]) {
        for (const [key, window] of map) {
          if (nowMs - window[window.length - 1]! >= this.options.windowMs) map.delete(key);
        }
      }
      this.nextSweepMs = nowMs + Math.min(this.options.windowMs, 1000);
    }
    if (!this.record(this.invites, input.inviteId, this.options.perInvite, nowMs)) return 'invite';
    if (input.ip !== null) {
      if (!this.record(this.ips, input.ip, this.options.perIp, nowMs)) return 'ip';
    }
    return 'allowed';
  }

  /** Bounded, token-free diagnostics for the operations snapshot. */
  get retained() {
    return {
      inviteKeys: this.invites.size,
      ipKeys: this.ips.size,
      timestamps: [...this.invites.values(), ...this.ips.values()].reduce(
        (sum, entries) => sum + entries.length,
        0,
      ),
    };
  }

  private record(map: Map<string, number[]>, key: string, limit: number, nowMs: number) {
    if (!map.has(key) && map.size >= this.maxKeys) return false;
    const window = (map.get(key) ?? []).filter((at) => nowMs - at < this.options.windowMs);
    // Rejected traffic neither allocates another timestamp nor extends the cooldown.
    if (window.length >= limit) return false;
    window.push(nowMs);
    map.set(key, window);
    return true;
  }
}
