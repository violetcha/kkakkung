/**
 * Display-only clock probe handling. The client's `clientSentAtMs` is untrusted input echoed
 * back verbatim; the server stamps its own monotonic receive/send times. Probes never touch
 * game state, TTLs or liveness, and are limited to 5 per second per connection.
 */
import {
  CLOCK_PROBE_LIMIT_PER_SECOND,
  clockProbeSchema,
  type ClockReply,
} from '@kkakkung/protocol/game-messages';

export type ClockSyncResult =
  | Readonly<{ status: 'reply'; reply: ClockReply }>
  | Readonly<{ status: 'rejected' }>
  | Readonly<{ status: 'limited' }>;

export class ClockSync {
  private readonly windows = new Map<string, number[]>();
  readonly limitPerSecond: number;

  constructor(
    private readonly options: { serverEpoch: string; now: () => number; limitPerSecond?: number },
  ) {
    this.limitPerSecond = options.limitPerSecond ?? CLOCK_PROBE_LIMIT_PER_SECOND;
  }

  handle(connectionId: string, payload: unknown): ClockSyncResult {
    const serverReceivedAtMs = this.options.now();
    const parsed = clockProbeSchema.safeParse(payload);
    if (!parsed.success) return { status: 'rejected' };
    const window = (this.windows.get(connectionId) ?? []).filter(
      (at) => serverReceivedAtMs - at < 1000,
    );
    if (window.length >= this.limitPerSecond) {
      this.windows.set(connectionId, window);
      return { status: 'limited' };
    }
    window.push(serverReceivedAtMs);
    this.windows.set(connectionId, window);
    return {
      status: 'reply',
      reply: {
        probeId: parsed.data.probeId,
        clientSentAtMs: parsed.data.clientSentAtMs,
        serverReceivedAtMs,
        serverSentAtMs: this.options.now(),
        serverEpoch: this.options.serverEpoch,
      },
    };
  }

  forget(connectionId: string) {
    this.windows.delete(connectionId);
  }
}
