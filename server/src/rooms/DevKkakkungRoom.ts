/**
 * Development (0.1) room preserving the team's original kkakkung wire contract for the local
 * regression flow. Not the product room: it publishes the whole maze and every player. It is
 * registered only when no product profile is configured and never in production.
 */
import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import {
  teamMoveSchema,
  teamReadySchema,
  teamTurnSchema,
  type TeamMove,
  type TeamTurn,
} from '@kkakkung/protocol/game-messages';
import { Exit, GameState, Player } from './schema/GameState.js';
import * as domain from '../domain/index.js';
import { roomAdmission } from '../session/RoomAdmission.js';
import type { GameSnapshot, PlayerState } from '../domain/index.js';

const TICK_MS = 50;
const ROUND_MS = 3 * 60 * 1000;
function rejectedSequence(value: unknown) {
  if (typeof value !== 'object' || value === null || !('seq' in value)) return -1;
  return Number.isSafeInteger(value.seq) && (value.seq as number) >= 0 ? (value.seq as number) : -1;
}

export class DevKkakkungRoom extends Room<{ state: GameState }> {
  maxClients = 6;
  state = new GameState();
  private snapshot!: GameSnapshot;
  private readonly playerState = new Map<string, PlayerState>();
  private claimed = false;

  onCreate() {
    roomAdmission.acquire(this.roomId);
    this.claimed = true;
    this.state.roomCode = this.roomId.slice(0, 6).toUpperCase();
    const maze = domain.generateMaze(Date.now());
    this.snapshot = { phase: 'waiting', tick: 0, timeLeft: 0, maze, players: this.playerState };
    this.state.maze.push(...maze);

    this.onMessage('move', (client, payload: unknown) => {
      const parsed = teamMoveSchema.safeParse(payload);
      if (!parsed.success)
        return client.send('rejected', {
          seq: rejectedSequence(payload),
          reason: 'invalid-message',
        });
      this.handleMove(client, parsed.data);
    });
    this.onMessage('turn', (client, payload: unknown) => {
      const parsed = teamTurnSchema.safeParse(payload);
      if (!parsed.success)
        return client.send('rejected', {
          seq: rejectedSequence(payload),
          reason: 'invalid-message',
        });
      this.handleTurn(client, parsed.data);
    });
    this.onMessage('ready', (client, payload: unknown) => {
      if (!teamReadySchema.safeParse(payload).success)
        return client.send('rejected', { seq: -1, reason: 'invalid-message' });
      this.handleReady(client);
    });
    this.patchRate = TICK_MS;
    this.setTimestep(() => this.tick(), TICK_MS);
  }

  onJoin(client: Client) {
    const index = this.state.players.size;
    // Development assignment only; lobby role selection remains TODO.
    const role = index % 2 === 0 ? 'runner' : 'tagger';
    const spawn = domain.pickSpawn(this.snapshot.maze as Uint8Array, role, Math.floor(index / 2));
    this.state.players.set(client.sessionId, new Player({ id: client.sessionId, role, ...spawn }));
    this.playerState.set(client.sessionId, {
      id: client.sessionId,
      role,
      ...spawn,
      status: 'alive',
      trapped: false,
      lastMoveAt: 0,
    });

    const view = new StateView();
    client.view = view;
    if (role === 'runner') {
      const exit = new Exit({
        ownerId: client.sessionId,
        wallX: 15,
        wallY: 0,
        side: 0,
        approachX: 15,
        approachY: 1,
      });
      this.state.exits.set(client.sessionId, exit);
      view.add(exit);
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.state.exits.delete(client.sessionId);
    this.playerState.delete(client.sessionId);
    // TODO: decide how an in-progress match handles disconnects.
  }

  onDispose() {
    if (this.claimed) roomAdmission.release(this.roomId);
    this.claimed = false;
  }

  private handleMove(client: Client, message: TeamMove) {
    if (this.state.phase !== 'playing') return;
    const player = this.playerState.get(client.sessionId);
    const syncedPlayer = this.state.players.get(client.sessionId);
    if (!player || !syncedPlayer) return;
    const now = Date.now();
    const result = domain.tryMove(this.snapshot, client.sessionId, message.dir, now);
    if (!result.ok) return client.send('rejected', { seq: message.seq, reason: result.reason });
    const vector = domain.DIR_VECTORS[player.dir];
    const sign = message.dir === 'forward' ? 1 : -1;
    player.x += vector.dx * sign;
    player.y += vector.dy * sign;
    player.lastMoveAt = now;
    syncedPlayer.x = player.x;
    syncedPlayer.y = player.y;
  }

  private handleTurn(client: Client, message: TeamTurn) {
    if (this.state.phase !== 'playing') return;
    const player = this.playerState.get(client.sessionId);
    const syncedPlayer = this.state.players.get(client.sessionId);
    if (!player || !syncedPlayer) return;
    player.dir = domain.turn(player.dir, message.dir);
    syncedPlayer.dir = player.dir;
  }

  private handleReady(client: Client) {
    if (this.state.phase !== 'waiting') return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.ready = true;
    const players = [...this.state.players.values()];
    if (players.length >= 2 && players.every((candidate) => candidate.ready)) this.startRound();
  }

  private startRound() {
    this.state.phase = 'playing';
    this.snapshot.phase = 'playing';
    this.state.timeLeft = ROUND_MS;
    this.snapshot.timeLeft = ROUND_MS;
    void this.lock();
  }

  private endRound(winner: string) {
    this.state.phase = 'result';
    this.snapshot.phase = 'result';
    this.broadcast('result', { winner });
  }

  private tick() {
    this.state.tick += 1;
    this.snapshot.tick = this.state.tick;
    if (this.state.phase !== 'playing') return;
    this.state.timeLeft = Math.max(0, this.state.timeLeft - TICK_MS);
    this.snapshot.timeLeft = this.state.timeLeft;
    for (const event of domain.checkCapture(this.snapshot)) {
      const runner = this.playerState.get(event.runnerId);
      const syncedPlayer = this.state.players.get(event.runnerId);
      if (runner && syncedPlayer) {
        runner.status = 'captured';
        syncedPlayer.status = 'captured';
      }
      this.broadcast('captured', event);
    }
    const winner = domain.checkWinCondition(this.snapshot);
    if (winner) this.endRound(`${winner}s`);
    else if (this.state.timeLeft <= 0) this.endRound('taggers');
  }
}
