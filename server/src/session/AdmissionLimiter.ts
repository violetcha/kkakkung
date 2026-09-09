/**
 * Session attempt limiter: invitation-first, with a secondary per-IP bucket sized for school
 * NAT sharing. All three values are required positive safe integers from F configuration;
 * no default rate is invented here.
 */
export type AdmissionLimiterOptions = Readonly<{
  windowMs: number;
  perInvite: number;
  perIp: number;
}>;

export type AdmissionVerdict = 'allowed' | 'invite' | 'ip';

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export class AdmissionLimiter {
  private readonly invites = new Map<string, number[]>();
  private readonly ips = new Map<string, number[]>();

  constructor(readonly options: AdmissionLimiterOptions) {
    if (
      !positiveSafeInteger(options.windowMs) ||
      !positiveSafeInteger(options.perInvite) ||
      !positiveSafeInteger(options.perIp)
    )
      throw new Error('INVALID_ADMISSION_LIMITS');
  }

  /** Records the attempt and reports which bucket, if any, refuses it. Invite is checked first. */
  attempt(input: { inviteId: string; ip: string | null }, nowMs: number): AdmissionVerdict {
    const inviteWindow = this.record(this.invites, input.inviteId, nowMs);
    if (inviteWindow > this.options.perInvite) return 'invite';
    if (input.ip !== null) {
      const ipWindow = this.record(this.ips, input.ip, nowMs);
      if (ipWindow > this.options.perIp) return 'ip';
    }
    return 'allowed';
  }

  private record(map: Map<string, number[]>, key: string, nowMs: number) {
    const window = (map.get(key) ?? []).filter((at) => nowMs - at < this.options.windowMs);
    window.push(nowMs);
    map.set(key, window);
    return window.length;
  }
}
