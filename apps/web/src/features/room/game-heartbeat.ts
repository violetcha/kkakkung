import {
  gameHeartbeatSchema,
  HEARTBEAT_TIMEOUT_MS,
  type GameHeartbeat,
  type HeartbeatAck,
} from '@kkakkung/protocol/game-messages';

export function createGameHeartbeat(deps: {
  now(): number;
  ack(value: HeartbeatAck): void;
  lost(): void;
  onAnchor?(value: GameHeartbeat): void;
}) {
  let matchId = '';
  let epoch: string | null = null;
  let sequence = -1;
  let last = deps.now();
  let terminal = false;
  return {
    setMatch(next: string) {
      if (next !== matchId) {
        matchId = next;
        sequence = -1;
      }
    },
    receive(value: unknown) {
      const result = gameHeartbeatSchema.safeParse(value);
      if (terminal || !result.success) return false;
      const heartbeat = result.data;
      if (
        heartbeat.matchId !== matchId ||
        (epoch !== null && heartbeat.serverEpoch !== epoch) ||
        heartbeat.heartbeatSeq <= sequence
      )
        return false;
      epoch = heartbeat.serverEpoch;
      sequence = heartbeat.heartbeatSeq;
      last = deps.now();
      deps.ack({ serverEpoch: epoch, matchId, heartbeatSeq: sequence });
      deps.onAnchor?.(heartbeat);
      return true;
    },
    poll() {
      if (!terminal && deps.now() - last >= HEARTBEAT_TIMEOUT_MS) {
        terminal = true;
        deps.lost();
      }
    },
    close() {
      if (!terminal) {
        terminal = true;
        deps.lost();
      }
    },
    dispose() {
      terminal = true;
    },
  };
}
