/**
 * Team practice timing and readiness. Each team practices in its own logical instance for at
 * most 60 seconds; everyone reporting PRACTICE_READY ends it early. Time alone never forges a
 * device-ready state: if someone withdrew READY, the room returns to DEVICE_CHECK.
 */
import type { Role } from '@kkakkung/protocol/game-schema';
import type { OutcomeResult } from '../game/ports.js';

export const PRACTICE_MAX_MS = 60_000;

export type PracticeTeams = Readonly<Record<Role, readonly string[]>>;

export class PracticeCoordinator {
  private startedAtMs: number | null = null;
  private teamsValue: PracticeTeams | null = null;
  private readonly practiceReady = new Set<string>();

  constructor(private readonly options: { maxDurationMs?: number } = {}) {}

  get maxDurationMs() {
    return this.options.maxDurationMs ?? PRACTICE_MAX_MS;
  }

  get active() {
    return this.startedAtMs !== null;
  }

  get teams() {
    return this.teamsValue;
  }

  start(roles: ReadonlyMap<string, Role>, nowMs: number): PracticeTeams {
    const teams: Record<Role, string[]> = { runner: [], tagger: [] };
    for (const [playerId, role] of roles) teams[role].push(playerId);
    if (teams.runner.length > 3 || teams.tagger.length > 3)
      throw new Error('PRACTICE_TEAM_TOO_LARGE');
    this.teamsValue = teams;
    this.startedAtMs = nowMs;
    this.practiceReady.clear();
    return teams;
  }

  teamOf(playerId: string): Role | null {
    if (!this.teamsValue) return null;
    if (this.teamsValue.runner.includes(playerId)) return 'runner';
    if (this.teamsValue.tagger.includes(playerId)) return 'tagger';
    return null;
  }

  applyPracticeReady(actorId: string, ready: boolean): OutcomeResult {
    if (!this.active || this.teamOf(actorId) === null)
      return { result: 'rejected', code: 'INVALID_PHASE' };
    if (ready) this.practiceReady.add(actorId);
    else this.practiceReady.delete(actorId);
    return { result: 'applied', code: null };
  }

  isPracticeReady(playerId: string) {
    return this.practiceReady.has(playerId);
  }

  /** Early end when every participant reported ready; timeout at the cap. */
  evaluate(
    nowMs: number,
    participants: readonly string[],
  ): 'continue' | 'end-all-ready' | 'end-timeout' {
    if (this.startedAtMs === null) return 'continue';
    if (participants.length > 0 && participants.every((id) => this.practiceReady.has(id)))
      return 'end-all-ready';
    if (nowMs - this.startedAtMs >= this.maxDurationMs) return 'end-timeout';
    return 'continue';
  }

  /** Where to go after practice: only device-ready players may proceed to map finalizing. */
  next(
    participants: readonly string[],
    deviceReady: (playerId: string) => boolean,
  ): 'to-map-finalizing' | 'to-device-check' {
    return participants.every(deviceReady) ? 'to-map-finalizing' : 'to-device-check';
  }

  stop() {
    this.startedAtMs = null;
    this.teamsValue = null;
    this.practiceReady.clear();
  }
}
