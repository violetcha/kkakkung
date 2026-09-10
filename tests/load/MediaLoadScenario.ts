// F-17 / QA-11 staged real-media load: pure planning and judgement only. `buildScenario` turns
// the preflight's stage durations and budget into a 1→3→5 room plan with participant-minutes
// and byte estimates; `evaluateMediaStage` judges one stage's recorded samples. Nothing here
// touches the clock, the network or Cloud; scripts/run-media-load.mjs starts the real stages and
// tests/load/media-load.test.ts checks these functions on finite fixtures.
import { describe, type Distribution } from './LoadStats.ts';

export const MEDIA_LOAD_THRESHOLDS = Object.freeze({
  participantsPerRoom: 6,
  /** Effective allow/deny latency: policy decision → first new marker (allow) / sustained silence (deny). */
  effectP95Ms: 500,
  effectP99Ms: 1000,
  /** Whole-server management API budget per rolling minute, and no 429 at all. */
  apiCallsPer60s: 600,
  tooManyRequests: 0,
  /** A stage must leave no unconfirmed retirement behind before the next one may start. */
  unresolvedRetirements: 0,
  /** Preparation and cleanup overhead reserved per stage on top of the measured duration. */
  overheadSeconds: 120,
  /** Synthetic 320×240 face + tone per participant, both directions, rounded up. */
  bytesPerParticipantMinute: 12 * 1024 * 1024,
});

export type MediaStagePlan = Readonly<{
  rooms: 1 | 3 | 5;
  sessions: number;
  durationSeconds: number;
  participantMinutes: number;
  bytes: number;
}>;

export type MediaScenario = Readonly<{
  stages: readonly MediaStagePlan[];
  totalParticipantMinutes: number;
  totalBytes: number;
  /** Stages the budget covers in order; the first stage that does not fit stops the plan. */
  affordableStages: number;
}>;

export type ScenarioInput = Readonly<{
  stages: readonly (1 | 3 | 5)[];
  stageDurationSeconds: Readonly<Record<'1' | '3' | '5', number>>;
  remainingMinutes: number;
  remainingBytes: number;
  reservation: Readonly<{ participantMinutes: number; bytes: number }>;
}>;

/** Pure plan. Throws on a missing or non-positive stage duration: no default ever spends budget. */
export function buildScenario(input: ScenarioInput): MediaScenario {
  if (input.stages.length === 0) throw new Error('MEDIA_LOAD_NO_STAGES');
  const stages: MediaStagePlan[] = input.stages.map((rooms) => {
    const duration = input.stageDurationSeconds[String(rooms) as '1' | '3' | '5'];
    if (!Number.isSafeInteger(duration) || duration <= 0)
      throw new Error(`MEDIA_LOAD_STAGE_DURATION_MISSING:${rooms}`);
    const sessions = rooms * MEDIA_LOAD_THRESHOLDS.participantsPerRoom;
    const minutes = (sessions * (duration + MEDIA_LOAD_THRESHOLDS.overheadSeconds)) / 60;
    return {
      rooms,
      sessions,
      durationSeconds: duration,
      participantMinutes: Math.ceil(minutes),
      bytes: Math.ceil(minutes) * MEDIA_LOAD_THRESHOLDS.bytesPerParticipantMinute,
    };
  });
  let minutes = 0;
  let bytes = 0;
  let affordable = 0;
  for (const stage of stages) {
    const nextMinutes = minutes + stage.participantMinutes;
    const nextBytes = bytes + stage.bytes;
    const withinRemaining =
      nextMinutes <= input.remainingMinutes && nextBytes <= input.remainingBytes;
    const withinReservation =
      nextMinutes <= input.reservation.participantMinutes && nextBytes <= input.reservation.bytes;
    if (!withinRemaining || !withinReservation) break;
    minutes = nextMinutes;
    bytes = nextBytes;
    affordable++;
  }
  return {
    stages,
    totalParticipantMinutes: stages.reduce((s, x) => s + x.participantMinutes, 0),
    totalBytes: stages.reduce((s, x) => s + x.bytes, 0),
    affordableStages: affordable,
  };
}

export type AudibilityObservation = Readonly<{
  /** Shortest acoustic path in cells at the moment of observation. */
  distanceCells: 5 | 6 | 7;
  /** Whether the pair was already allowed before this step (6 cells is a boundary: keep the state). */
  previouslyAllowed: boolean;
  observed: 'allowed' | 'blocked';
}>;

/** 5 → allowed, 7 → blocked, 6 → whatever the pair already was (hysteresis at the boundary). */
export function expectedAudibility(
  o: Pick<AudibilityObservation, 'distanceCells' | 'previouslyAllowed'>,
) {
  if (o.distanceCells === 5) return 'allowed';
  if (o.distanceCells === 7) return 'blocked';
  return o.previouslyAllowed ? 'allowed' : 'blocked';
}

export type MediaStageInput = Readonly<{
  rooms: 1 | 3 | 5;
  durationSeconds: number;
  sessionsConnected: number;
  effectLatencyMs: readonly number[];
  /** Management API calls counted per rolling 60 s window over the stage. */
  apiCallsPer60s: readonly number[];
  tooManyRequests: number;
  audibility: readonly AudibilityObservation[];
  unresolvedRetirements: number;
  /** Game-side judgement of the same interval (QA-10 runner), or null when not run together. */
  gameStageStatus: 'PASS' | 'INCOMPLETE' | 'FAIL' | null;
}>;

export type MediaCheck = Readonly<{
  name: string;
  status: 'PASS' | 'FAIL' | 'NOT_MEASURED';
  value: number | null;
  limit: number | null;
  detail?: string;
}>;

export type MediaStageResult = Readonly<{
  rooms: number;
  status: 'PASS' | 'FAIL' | 'INCOMPLETE';
  /** The next, larger stage must not start. */
  stopEscalation: boolean;
  /** New grants stay locked and reservations kept until an operator resolves cleanup. */
  holdGrants: boolean;
  checks: readonly MediaCheck[];
  effectLatency: Distribution | null;
}>;

const check = (
  name: string,
  value: number | null,
  limit: number | null,
  ok: (v: number) => boolean,
  detail?: string,
): MediaCheck =>
  value === null || Number.isNaN(value)
    ? { name, status: 'NOT_MEASURED', value: null, limit, detail }
    : { name, status: ok(value) ? 'PASS' : 'FAIL', value, limit, detail };

export function evaluateMediaStage(input: MediaStageInput): MediaStageResult {
  const expectedSessions = input.rooms * MEDIA_LOAD_THRESHOLDS.participantsPerRoom;
  const effect = input.effectLatencyMs.length ? describe(input.effectLatencyMs) : null;
  const apiPeak = input.apiCallsPer60s.length ? Math.max(...input.apiCallsPer60s) : null;
  const audibilityMisses = input.audibility.filter((o) => expectedAudibility(o) !== o.observed);
  const checks: MediaCheck[] = [
    check(
      'sessions.connected',
      input.sessionsConnected,
      expectedSessions,
      (v) => v === expectedSessions,
      input.sessionsConnected < expectedSessions
        ? `${input.sessionsConnected}/${expectedSessions} sessions: stage below target, not a ${input.rooms}-room result`
        : undefined,
    ),
    check(
      'effect.p95Ms',
      effect?.p95 ?? null,
      MEDIA_LOAD_THRESHOLDS.effectP95Ms,
      (v) => v <= MEDIA_LOAD_THRESHOLDS.effectP95Ms,
    ),
    check(
      'effect.p99Ms',
      effect?.p99 ?? null,
      MEDIA_LOAD_THRESHOLDS.effectP99Ms,
      (v) => v <= MEDIA_LOAD_THRESHOLDS.effectP99Ms,
    ),
    check(
      'api.callsPer60s.max',
      apiPeak,
      MEDIA_LOAD_THRESHOLDS.apiCallsPer60s,
      (v) => v <= MEDIA_LOAD_THRESHOLDS.apiCallsPer60s,
    ),
    check(
      'api.tooManyRequests',
      input.tooManyRequests,
      MEDIA_LOAD_THRESHOLDS.tooManyRequests,
      (v) => v === 0,
    ),
    check(
      'audibility.boundary',
      input.audibility.length ? audibilityMisses.length : null,
      0,
      (v) => v === 0,
      input.audibility.length
        ? `${input.audibility.length} observations across 5/6/7 cells, ${audibilityMisses.length} mismatches`
        : 'no 5→6→7→6→5 movement observed: idle connections are not a media load result',
    ),
    check(
      'cleanup.unresolvedRetirements',
      input.unresolvedRetirements,
      MEDIA_LOAD_THRESHOLDS.unresolvedRetirements,
      (v) => v === 0,
    ),
    check(
      'game.stage',
      input.gameStageStatus === null ? null : input.gameStageStatus === 'FAIL' ? 0 : 1,
      1,
      (v) => v === 1,
      input.gameStageStatus === null
        ? 'game-side judgement not recorded for this interval (QA-10)'
        : `game stage ${input.gameStageStatus}`,
    ),
  ];
  const failed = checks.some((c) => c.status === 'FAIL');
  const unmeasured = checks.some((c) => c.status === 'NOT_MEASURED');
  const cleanupFailed = input.unresolvedRetirements > 0;
  return {
    rooms: input.rooms,
    status: failed ? 'FAIL' : unmeasured ? 'INCOMPLETE' : 'PASS',
    // Any failure or unmeasured value at this size forbids the larger stage (26.2: never open an
    // unverified room count as an operating limit).
    stopEscalation: failed || unmeasured,
    holdGrants: cleanupFailed,
    checks,
    effectLatency: effect,
  };
}
