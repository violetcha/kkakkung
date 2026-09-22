/**
 * Authoritative-connection liveness. The server sends `game-heartbeat` every 2 seconds and
 * records the last valid `game-heartbeat-ack` per connection on the monotonic clock. Acks
 * from another epoch/match, duplicates and unsent future sequence numbers never refresh
 * liveness. Six seconds of silence or an explicit socket close produce exactly one
 * CONNECTION_LOST control per player; the core decides what that means for the match.
 *
 * Silence is measured on the server's own clock, so a server that stops running for a while
 * (GC storm, paused container, debugger) would see every client as silent when it resumes and
 * drop the whole room. A gap between sweeps of at least one heartbeat interval is therefore the
 * server's stall, not the clients' silence: the stalled span is not counted, and what each
 * client had been silent before the stall carries over (S15P21C204-337).
 */
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  heartbeatAckSchema,
  type GameHeartbeat,
} from '@kkakkung/protocol/game-messages';
import type { ControlIntent } from './ports.js';

type Connection = {
  playerId: string;
  lastSentSeq: number;
  lastAckedSeq: number;
  lastValidAckMs: number;
  lastSentMs: number | null;
  lost: boolean;
};

export type HeartbeatOptions = Readonly<{
  serverEpoch: string;
  intervalMs?: number;
  timeoutMs?: number;
  /** Called once per detected stall with its length and how many live connections it spared. */
  onStall?: (stallMs: number, connections: number) => void;
}>;

export class HeartbeatTracker {
  private readonly connections = new Map<string, Connection>();
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly serverEpoch: string;
  private readonly onStall: HeartbeatOptions['onStall'];
  private lastSweepMs: number | null = null;

  constructor(options: HeartbeatOptions) {
    this.serverEpoch = options.serverEpoch;
    this.onStall = options.onStall;
    this.intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  }

  register(connectionId: string, playerId: string, nowMs: number) {
    this.connections.set(connectionId, {
      playerId,
      lastSentSeq: 0,
      lastAckedSeq: 0,
      lastValidAckMs: nowMs,
      lastSentMs: null,
      lost: false,
    });
  }

  has(connectionId: string) {
    return this.connections.has(connectionId);
  }

  /** Returns the heartbeats due now (one per connection whose interval elapsed). */
  due(
    nowMs: number,
    matchId: string,
    serverTick: number,
  ): { connectionId: string; heartbeat: GameHeartbeat }[] {
    const out: { connectionId: string; heartbeat: GameHeartbeat }[] = [];
    for (const [connectionId, connection] of this.connections) {
      if (connection.lost) continue;
      if (connection.lastSentMs !== null && nowMs - connection.lastSentMs < this.intervalMs)
        continue;
      connection.lastSentSeq += 1;
      connection.lastSentMs = nowMs;
      out.push({
        connectionId,
        heartbeat: {
          serverEpoch: this.serverEpoch,
          matchId,
          heartbeatSeq: connection.lastSentSeq,
          serverTick,
          serverTimeMs: nowMs,
        },
      });
    }
    return out;
  }

  /** Validates an ack; only an ack for a sent, not-yet-acked seq of this epoch/match counts. */
  ack(
    connectionId: string,
    payload: unknown,
    matchId: string,
    nowMs: number,
  ): 'accepted' | 'ignored' {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.lost) return 'ignored';
    const parsed = heartbeatAckSchema.safeParse(payload);
    if (!parsed.success) return 'ignored';
    const ack = parsed.data;
    if (ack.serverEpoch !== this.serverEpoch || ack.matchId !== matchId) return 'ignored';
    if (ack.heartbeatSeq > connection.lastSentSeq || ack.heartbeatSeq <= connection.lastAckedSeq)
      return 'ignored';
    connection.lastAckedSeq = ack.heartbeatSeq;
    connection.lastValidAckMs = nowMs;
    return 'accepted';
  }

  /** Connections silent for the timeout become lost once and yield a single control. */
  sweep(nowMs: number): ControlIntent[] {
    const controls: ControlIntent[] = [];
    const previousSweepMs = this.lastSweepMs;
    this.lastSweepMs = nowMs;
    const stalledFrom =
      previousSweepMs !== null && nowMs - previousSweepMs >= this.intervalMs
        ? previousSweepMs
        : null;
    let spared = 0;
    for (const connection of this.connections.values()) {
      if (connection.lost) continue;
      if (stalledFrom !== null) {
        // Keep the silence observed up to the last sweep; the stalled span itself does not count.
        const silentBefore = Math.max(0, stalledFrom - connection.lastValidAckMs);
        connection.lastValidAckMs = nowMs - silentBefore;
        spared += 1;
      }
      if (nowMs - connection.lastValidAckMs >= this.timeoutMs) {
        connection.lost = true;
        controls.push({ type: 'CONNECTION_LOST', playerId: connection.playerId });
      }
    }
    if (stalledFrom !== null && spared > 0) {
      try {
        this.onStall?.(nowMs - stalledFrom, spared);
      } catch {
        // Diagnostics never change liveness.
      }
    }
    return controls;
  }

  /** Explicit socket close: immediate single control, no six second wait. */
  close(connectionId: string): ControlIntent | null {
    const connection = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    if (!connection || connection.lost) return null;
    return { type: 'CONNECTION_LOST', playerId: connection.playerId };
  }

  forget(connectionId: string) {
    this.connections.delete(connectionId);
  }

  /** New match: liveness restarts; lost connections are dropped from tracking. */
  resetForMatch(nowMs: number) {
    for (const [id, connection] of this.connections) {
      if (connection.lost) this.connections.delete(id);
      else {
        connection.lastSentSeq = 0;
        connection.lastAckedSeq = 0;
        connection.lastSentMs = null;
        connection.lastValidAckMs = nowMs;
      }
    }
  }

  get size() {
    return this.connections.size;
  }
}
