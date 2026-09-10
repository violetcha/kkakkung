// F-02 / QA-01. Wraps the LiveKit gateway client (the same `GatewayClient` surface E's
// LiveKitGateway uses) so a test can pick, per requestId or per method, how one call misbehaves:
// `normal`, `delay-before-send` (the remote sees the call late), `drop-response` (the remote
// applied it, the caller never hears back), or `remote-success-then-local-timeout` (the remote
// applied it, the caller gets the answer only after its own deadline). The remote state stays the
// fake's or the real Cloud's; the adapter never claims a cancelled call was cancelled remotely.
// It records both timelines (caller-side and remote-side) so the evidence shows exactly which
// side saw what, with target digests instead of raw identities.
import { createHash } from 'node:crypto';
import type { GatewayClient } from '../../server/src/media/LiveKitGateway.ts';

export type FaultMode =
  'normal' | 'delay-before-send' | 'drop-response' | 'remote-success-then-local-timeout';

export type FaultRule = Readonly<{
  mode: FaultMode;
  /** Extra milliseconds before the remote call is made (delay-before-send) or before the response returns. */
  delayMs?: number;
  /** For remote-success-then-local-timeout: the caller's own deadline, in ms after send. */
  callerTimeoutMs?: number;
}>;

export type FaultTimelineEntry = Readonly<{
  requestId: string;
  method: keyof GatewayClient;
  /** sha256 prefix of the target (room/identity); never the raw value. */
  target: string;
  mode: FaultMode;
  callerSentAtMs: number;
  remoteAppliedAtMs: number | null;
  callerRespondedAtMs: number | null;
  callerOutcome: 'resolved' | 'rejected' | 'unknown' | 'pending';
  remoteOutcome: 'applied' | 'failed' | 'not-sent' | 'pending';
}>;

export type FaultAdapterOptions = Readonly<{
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Rule per requestId; falls back to `defaultRule` then to normal. */
  rules?: Readonly<Record<string, FaultRule>>;
  defaultRule?: FaultRule;
}>;

export class LocalTimeoutError extends Error {
  constructor(readonly requestId: string) {
    super(`LOCAL_TIMEOUT:${requestId}`);
  }
}

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 12);

/**
 * The adapter exposes the wrapped methods with an explicit `requestId` so the scheduler's
 * per-request policy can be chosen. Each call yields one timeline entry that the test reads
 * back through `timeline()`.
 */
export class GatewayFaultAdapter {
  private readonly entries: FaultTimelineEntry[] = [];
  private readonly rules = new Map<string, FaultRule>();

  constructor(
    private readonly client: GatewayClient,
    private readonly options: FaultAdapterOptions,
  ) {
    for (const [id, rule] of Object.entries(options.rules ?? {})) this.rules.set(id, rule);
  }

  setRule(requestId: string, rule: FaultRule) {
    this.rules.set(requestId, rule);
  }

  timeline(): readonly FaultTimelineEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  updateSubscriptions(
    requestId: string,
    room: string,
    identity: string,
    trackSids: string[],
    subscribe: boolean,
  ) {
    return this.run(requestId, 'updateSubscriptions', `${room}/${identity}`, () =>
      this.client.updateSubscriptions(room, identity, trackSids, subscribe),
    );
  }

  removeParticipant(requestId: string, room: string, identity: string) {
    return this.run(requestId, 'removeParticipant', `${room}/${identity}`, () =>
      this.client.removeParticipant(room, identity),
    );
  }

  getParticipant(requestId: string, room: string, identity: string) {
    return this.run(requestId, 'getParticipant', `${room}/${identity}`, () =>
      this.client.getParticipant(room, identity),
    );
  }

  private async run<T>(
    requestId: string,
    method: keyof GatewayClient,
    rawTarget: string,
    call: () => Promise<T>,
  ): Promise<T> {
    const rule = this.rules.get(requestId) ?? this.options.defaultRule ?? { mode: 'normal' };
    const entry: {
      -readonly [K in keyof FaultTimelineEntry]: FaultTimelineEntry[K];
    } = {
      requestId,
      method,
      target: digest(rawTarget),
      mode: rule.mode,
      callerSentAtMs: this.options.now(),
      remoteAppliedAtMs: null,
      callerRespondedAtMs: null,
      callerOutcome: 'pending',
      remoteOutcome: 'pending',
    };
    this.entries.push(entry);
    const remote = async () => {
      if (rule.mode === 'delay-before-send' && rule.delayMs) await this.options.sleep(rule.delayMs);
      try {
        const value = await call();
        entry.remoteAppliedAtMs = this.options.now();
        entry.remoteOutcome = 'applied';
        return value;
      } catch (error) {
        entry.remoteAppliedAtMs = this.options.now();
        entry.remoteOutcome = 'failed';
        throw error;
      }
    };
    switch (rule.mode) {
      case 'normal':
      case 'delay-before-send': {
        try {
          const value = await remote();
          entry.callerRespondedAtMs = this.options.now();
          entry.callerOutcome = 'resolved';
          return value;
        } catch (error) {
          entry.callerRespondedAtMs = this.options.now();
          entry.callerOutcome = 'rejected';
          throw error;
        }
      }
      case 'drop-response': {
        // The remote call runs to completion; the caller's promise never settles.
        void remote().catch(() => undefined);
        entry.callerOutcome = 'unknown';
        return new Promise<T>(() => undefined);
      }
      case 'remote-success-then-local-timeout': {
        const remotePromise = remote();
        const timeout = rule.callerTimeoutMs ?? 1000;
        await this.options.sleep(timeout);
        // The caller gives up here; the remote result (already applied or still pending) is kept
        // on the timeline and never reported as cancelled.
        entry.callerRespondedAtMs = this.options.now();
        entry.callerOutcome = 'unknown';
        void remotePromise.catch(() => undefined);
        throw new LocalTimeoutError(requestId);
      }
    }
  }
}
