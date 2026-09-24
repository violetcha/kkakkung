/**
 * Waiting phases for a room's seats (six for a match room, four for showcase). LOBBY holds until
 * every seat is connected, DEVICE_CHECK collects each player's own READY report (a client claim
 * that local device checks passed); once every seat reports ready the room is `all-ready`, but
 * roles are only assigned once the host sends ROOM_START — readiness alone does not start it.
 * Roles are drawn from `options.random` (plain `Math.random` unless a caller injects a seeded
 * source, e.g. in tests) or from the rematch role plan. Roles are never broadcast in the roster.
 */
import type { RoomRosterMessage } from '@kkakkung/protocol/game-messages';
import type { Phase, Role } from '@kkakkung/protocol/game-schema';
import type { OutcomeResult } from '../game/ports.js';
import { selectHost } from '../session/RoomExpiry.js';

export type LobbyParticipant = {
  playerId: string;
  nickname: string;
  joinOrder: number;
  connected: boolean;
  ready: boolean;
  live: boolean;
};

export type LobbyEvaluation = 'stay' | 'to-device-check' | 'to-lobby' | 'all-ready';

export class LobbyCoordinator {
  private readonly participants = new Map<string, LobbyParticipant>();
  private hostId: string | null = null;

  constructor(
    private readonly options: { capacity?: number; random: () => number } = { random: Math.random },
  ) {}

  get capacity() {
    return this.options.capacity ?? 6;
  }

  get host() {
    return this.hostId;
  }

  add(playerId: string, nickname: string, joinOrder: number) {
    const existing = this.participants.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.live = true;
      return existing;
    }
    const participant: LobbyParticipant = {
      playerId,
      nickname,
      joinOrder,
      connected: true,
      ready: false,
      live: true,
    };
    this.participants.set(playerId, participant);
    this.refreshHost();
    return participant;
  }

  /**
   * S15P21C204-295. 끊겨도 준비 표시는 남긴다. 잠깐 끊겼다 돌아온 사람이 처음부터 다시 누르는
   * 일을 없앤다. 시작 판정은 evaluate 가 "연결된 사람이 정원만큼 있고 모두 준비" 를 보므로,
   * 끊긴 사람의 준비가 남아 있어도 그 사람 없이 시작되지 않는다.
   */
  setConnected(playerId: string, connected: boolean) {
    const participant = this.participants.get(playerId);
    if (!participant) return;
    participant.connected = connected;
    this.refreshHost();
  }

  remove(playerId: string) {
    this.participants.delete(playerId);
    this.refreshHost();
  }

  get(playerId: string) {
    return this.participants.get(playerId) ?? null;
  }

  list(): LobbyParticipant[] {
    return [...this.participants.values()].sort((a, b) => a.joinOrder - b.joinOrder);
  }

  connectedCount() {
    return this.list().filter((p) => p.connected).length;
  }

  isReady(playerId: string) {
    return this.participants.get(playerId)?.ready ?? false;
  }

  /** READY is the authenticated player's own device-check report; only DEVICE_CHECK accepts it. */
  applyReady(actorId: string, ready: boolean, phase: Phase): OutcomeResult {
    if (phase !== 'DEVICE_CHECK') return { result: 'rejected', code: 'INVALID_PHASE' };
    const participant = this.participants.get(actorId);
    if (!participant || !participant.connected) return { result: 'rejected', code: 'NOT_ACTIVE' };
    participant.ready = ready;
    return { result: 'applied', code: null };
  }

  clearReady() {
    for (const participant of this.participants.values()) participant.ready = false;
  }

  /**
   * S15P21C204-258. Marks a server-owned participant (a demo room puppet) ready. It has no
   * client to make the report, and READY from a socket still goes through `applyReady`.
   */
  markSystemReady(playerId: string): boolean {
    const participant = this.participants.get(playerId);
    if (!participant) return false;
    participant.ready = true;
    return true;
  }

  evaluate(phase: Phase): LobbyEvaluation {
    const connected = this.connectedCount();
    if (phase === 'LOBBY') return connected >= this.capacity ? 'to-device-check' : 'stay';
    if (phase === 'DEVICE_CHECK') {
      if (connected < this.capacity) return 'to-lobby';
      const everyone = this.list().filter((p) => p.connected);
      return everyone.length === this.capacity && everyone.every((p) => p.ready)
        ? 'all-ready'
        : 'stay';
    }
    return 'stay';
  }

  /**
   * 3:3 assignment. A rematch plan is honoured for remaining players and newcomers fill the
   * vacant role slots; without a plan the seeded random source shuffles the six.
   */
  assignRoles(plan: ReadonlyMap<string, Role> | null): Map<string, Role> {
    const players = this.list()
      .filter((p) => p.connected)
      .map((p) => p.playerId);
    if (players.length !== this.capacity) throw new Error('ROLE_ASSIGNMENT_REQUIRES_FULL_ROOM');
    const roles = new Map<string, Role>();
    const perRole = this.capacity / 2;
    let runners = 0;
    let taggers = 0;
    if (plan)
      for (const playerId of players) {
        const planned = plan.get(playerId);
        if (planned === 'runner' && runners < perRole) {
          roles.set(playerId, 'runner');
          runners++;
        } else if (planned === 'tagger' && taggers < perRole) {
          roles.set(playerId, 'tagger');
          taggers++;
        }
      }
    const unassigned = players.filter((id) => !roles.has(id));
    for (let i = unassigned.length - 1; i > 0; i--) {
      const j = Math.floor(this.options.random() * (i + 1));
      const a = unassigned[i]!;
      unassigned[i] = unassigned[j]!;
      unassigned[j] = a;
    }
    for (const playerId of unassigned) {
      if (runners < perRole) {
        roles.set(playerId, 'runner');
        runners++;
      } else {
        roles.set(playerId, 'tagger');
        taggers++;
      }
    }
    return roles;
  }

  roster(matchId: string, stateVersion: number, phase: Phase): RoomRosterMessage {
    return {
      matchId,
      stateVersion,
      phase,
      hostId: this.hostId ?? '',
      players: this.list().map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        ready: p.ready,
        connected: p.connected,
      })),
    };
  }

  private refreshHost() {
    this.hostId = selectHost(this.list(), this.hostId);
  }
}
