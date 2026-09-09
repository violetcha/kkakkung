/** Authoritative-connection heartbeat and display-only clock probe contracts. */
import { z } from 'zod';

const finiteNumber = z.number().finite();
const seq = z.number().int().nonnegative().safe();

export const HEARTBEAT_INTERVAL_MS = 2000;
export const HEARTBEAT_TIMEOUT_MS = 6000;
export const CLOCK_PROBE_LIMIT_PER_SECOND = 5;

export const gameHeartbeatSchema = z.strictObject({
  serverEpoch: z.string().min(1),
  matchId: z.string().min(1),
  heartbeatSeq: seq,
  serverTick: seq,
  /** Server monotonic ms. Never compared with the browser clock directly. */
  serverTimeMs: finiteNumber,
});
export type GameHeartbeat = z.infer<typeof gameHeartbeatSchema>;

export const heartbeatAckSchema = z.strictObject({
  serverEpoch: z.string().min(1),
  matchId: z.string().min(1),
  heartbeatSeq: seq,
});
export type HeartbeatAck = z.infer<typeof heartbeatAckSchema>;

export const clockProbeSchema = z.strictObject({
  probeId: z.string().min(1).max(64),
  /** Untrusted client time, echoed only. NaN/Infinity are rejected. */
  clientSentAtMs: finiteNumber,
});
export type ClockProbe = z.infer<typeof clockProbeSchema>;

export const clockReplySchema = clockProbeSchema.extend({
  serverReceivedAtMs: finiteNumber,
  serverSentAtMs: finiteNumber,
  serverEpoch: z.string().min(1),
});
export type ClockReply = z.infer<typeof clockReplySchema>;
