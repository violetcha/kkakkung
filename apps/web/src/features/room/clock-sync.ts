import {
  clockReplySchema,
  type ClockProbe,
  type GameHeartbeat,
} from '@kkakkung/protocol/game-messages';

export function createClockSync(deps: {
  now(): number;
  uuid(): string;
  send(probe: ClockProbe): void;
}) {
  let epoch: string | null = null;
  let samples: { rtt: number; offset: number }[] = [];
  const pending = new Map<string, number>();
  let burst = 5;
  let nextProbe = deps.now();
  let anchor: GameHeartbeat | null = null;
  function reset(next: string) {
    epoch = next;
    samples = [];
    pending.clear();
    burst = 5;
    nextProbe = deps.now();
    anchor = null;
  }
  const offset = () => {
    if (samples.length < 3) return null;
    return samples
      .toSorted((a, b) => a.rtt - b.rtt)
      .slice(0, 3)
      .map((s) => s.offset)
      .sort((a, b) => a - b)[1]!;
  };
  return {
    poll() {
      const now = deps.now();
      if (now < nextProbe) return;
      if (burst === 0) {
        burst = 5;
        samples = [];
      }
      const probe = { probeId: deps.uuid(), clientSentAtMs: now };
      pending.set(probe.probeId, now);
      deps.send(probe);
      burst--;
      nextProbe = now + (burst ? 250 : 10000);
      for (const [id, sent] of pending) if (now - sent > 2000) pending.delete(id);
    },
    receive(value: unknown) {
      const parsed = clockReplySchema.safeParse(value);
      if (!parsed.success) return false;
      const r = parsed.data;
      const sent = pending.get(r.probeId);
      if (sent === undefined || sent !== r.clientSentAtMs) return false;
      if (epoch !== null && epoch !== r.serverEpoch) {
        reset(r.serverEpoch);
        return false;
      }
      epoch = r.serverEpoch;
      pending.delete(r.probeId);
      const now = deps.now();
      const rtt = now - sent - (r.serverSentAtMs - r.serverReceivedAtMs);
      if (rtt < 0 || rtt > 1000 || r.serverSentAtMs < r.serverReceivedAtMs) return false;
      samples.push({ rtt, offset: (r.serverReceivedAtMs - sent + (r.serverSentAtMs - now)) / 2 });
      return true;
    },
    anchor(value: GameHeartbeat) {
      if (epoch !== null && epoch !== value.serverEpoch) reset(value.serverEpoch);
      epoch = value.serverEpoch;
      anchor = value;
    },
    serverNow() {
      const o = offset();
      return o === null ? null : deps.now() + o;
    },
    renderTick() {
      const o = offset();
      return !anchor || o === null
        ? null
        : anchor.serverTick + (deps.now() + o - anchor.serverTimeMs) / 50;
    },
    clear() {
      pending.clear();
      samples = [];
      anchor = null;
      epoch = null;
    },
  };
}
