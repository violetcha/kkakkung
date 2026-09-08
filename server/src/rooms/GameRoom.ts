import { Room, ServerError, type Client } from '@colyseus/core';
import {
  addPlayer,
  createWorld,
  removePlayer,
  stepWorld,
  type MoveCommand,
} from '@kkakkung/game-core';
import { joinOptionsSchema } from '@kkakkung/protocol/messages';
import { SandboxState } from '@kkakkung/protocol/schema';
import { PROTOCOL_VERSION } from '@kkakkung/protocol/version';
import type { SessionStore } from '../session/SessionStore.js';
import { TickScheduler } from '../game/TickScheduler.js';
import { toMoveCommand } from '../game/CommandAdapter.js';
import { projectSandbox } from '../game/PlayerProjection.js';
import { roomAdmission } from '../session/RoomAdmission.js';

export function createGameRoom(sessions: SessionStore) {
  return class GameRoom extends Room<{ state: SandboxState }> {
    maxClients = 6;
    maxMessagesPerSecond = 40;
    state = new SandboxState();
    private world = createWorld({ halfExtent: 8, speed: 4 });
    private readonly pending = new Map<string, { command: MoveCommand; receivedAt: number }>();
    private readonly lastAccepted = new Map<string, number>();
    private readonly scheduler = new TickScheduler();
    private claimed = false;

    onCreate() {
      roomAdmission.acquire(this.roomId);
      this.claimed = true;
      this.patchRate = 50;
      this.onMessage('move', (client, payload: unknown) => {
        const command = toMoveCommand(client.sessionId, payload);
        if (!command) return client.send('command-rejected', { code: 'INVALID_MOVE' });
        if (command.seq <= (this.lastAccepted.get(client.sessionId) ?? -1)) {
          return client.send('command-rejected', { code: 'STALE_SEQUENCE' });
        }
        this.lastAccepted.set(client.sessionId, command.seq);
        this.pending.set(client.sessionId, { command, receivedAt: performance.now() });
      });
      this.onMessage('*', (client) => client.send('command-rejected', { code: 'UNKNOWN_COMMAND' }));
      this.setTimestep((elapsedMs) => {
        try {
          this.scheduler.advance(elapsedMs, () => {
            const now = performance.now();
            const commands = [...this.pending.values()]
              .filter((input) => now - input.receivedAt <= 150)
              .map((input) => input.command);
            this.pending.clear();
            this.world = stepWorld(this.world, commands, 0.05);
            projectSandbox(this.world, this.state);
          });
        } catch {
          this.broadcast('command-rejected', { code: 'TICK_OVERLOAD' });
          void this.disconnect(4000);
        }
      }, 50);
    }

    onAuth(_client: Client, options: unknown) {
      const parsed = joinOptionsSchema.safeParse(options);
      if (!parsed.success) throw new ServerError(400, 'INVALID_JOIN');
      if (parsed.data.protocolVersion !== PROTOCOL_VERSION)
        throw new ServerError(409, 'PROTOCOL_MISMATCH');
      const session = sessions.consume(parsed.data.token);
      if (!session) throw new ServerError(401, 'INVALID_SESSION');
      return session;
    }

    onJoin(client: Client, _options: unknown, auth: { nickname: string }) {
      this.world = addPlayer(this.world, { id: client.sessionId, nickname: auth.nickname });
      projectSandbox(this.world, this.state);
    }

    onLeave(client: Client) {
      this.pending.delete(client.sessionId);
      this.lastAccepted.delete(client.sessionId);
      this.world = removePlayer(this.world, client.sessionId);
      projectSandbox(this.world, this.state);
    }

    onDispose() {
      if (this.claimed) roomAdmission.release(this.roomId);
      this.pending.clear();
    }
  };
}
