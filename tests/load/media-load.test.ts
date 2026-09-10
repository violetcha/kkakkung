// F-17 / QA-11 short unit tests: the staged media plan from a preflight, the stage judgement on
// finite fixtures, and the runner's argument → case mapping and budget gate. No clock, no Cloud.
import { describe, expect, it } from 'vitest';
import { planMediaLoad, selectMediaCase } from '../../scripts/run-media-load.mjs';
import {
  MEDIA_LOAD_THRESHOLDS,
  buildScenario,
  evaluateMediaStage,
  expectedAudibility,
  type MediaStageInput,
} from './MediaLoadScenario.ts';

const preflight = {
  remainingMinutes: 5000,
  remainingBytes: 50 * 1024 ** 3,
  budgetReservation: { reservationId: 'qa11', participantMinutes: 2000, bytes: 40 * 1024 ** 3 },
  maxRooms: 5,
  maxParticipants: 30,
  maxDurationSeconds: 1800,
  cleanupAllowanceSeconds: 300,
  stageDurationSeconds: { '1': 120, '3': 180, '5': 300 },
};

const stage = (over: Partial<MediaStageInput> = {}): MediaStageInput => ({
  rooms: 1,
  durationSeconds: 120,
  sessionsConnected: 6,
  effectLatencyMs: Array.from({ length: 100 }, (_, i) => 100 + i * 3),
  apiCallsPer60s: [120, 140, 130],
  tooManyRequests: 0,
  audibility: [
    { distanceCells: 5, previouslyAllowed: false, observed: 'allowed' },
    { distanceCells: 6, previouslyAllowed: true, observed: 'allowed' },
    { distanceCells: 7, previouslyAllowed: true, observed: 'blocked' },
    { distanceCells: 6, previouslyAllowed: false, observed: 'blocked' },
    { distanceCells: 5, previouslyAllowed: false, observed: 'allowed' },
  ],
  unresolvedRetirements: 0,
  gameStageStatus: 'PASS',
  ...over,
});

describe('staged plan', () => {
  it('builds 1→3→5 with sessions, participant-minutes and bytes from the preflight durations, and refuses a missing duration', () => {
    const plan = buildScenario({
      stages: [1, 3, 5],
      stageDurationSeconds: preflight.stageDurationSeconds,
      remainingMinutes: preflight.remainingMinutes,
      remainingBytes: preflight.remainingBytes,
      reservation: preflight.budgetReservation,
    });
    expect(plan.stages.map((s) => [s.rooms, s.sessions])).toEqual([
      [1, 6],
      [3, 18],
      [5, 30],
    ]);
    // 6 sessions × (120 + 120 overhead) s = 24 participant-minutes for the first stage.
    expect(plan.stages[0]!.participantMinutes).toBe(24);
    expect(plan.affordableStages).toBe(3);
    expect(() =>
      buildScenario({
        stages: [1, 3, 5],
        stageDurationSeconds: { '1': 120, '3': 0, '5': 300 } as never,
        remainingMinutes: 5000,
        remainingBytes: 1e12,
        reservation: preflight.budgetReservation,
      }),
    ).toThrow('MEDIA_LOAD_STAGE_DURATION_MISSING:3');
  });

  it('a short official budget covers only the first stages and the runner reports BLOCKED instead of substituting fake clients', () => {
    const plan = buildScenario({
      stages: [1, 3, 5],
      stageDurationSeconds: preflight.stageDurationSeconds,
      remainingMinutes: 100,
      remainingBytes: 1e12,
      reservation: preflight.budgetReservation,
    });
    expect(plan.affordableStages).toBe(1);
    const gate = planMediaLoad({ case: 'QA-11' }, { ...preflight, remainingMinutes: 100 });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/budget covers 1\/3 stages/);
    expect(gate.reason).toMatch(/no synthetic substitute/);
    expect(
      planMediaLoad({ case: 'QA-11' }, { ...preflight, stageDurationSeconds: undefined }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('stageDurationSeconds missing') });
    expect(planMediaLoad({ case: 'QA-11' }, preflight)).toMatchObject({ ok: true });
  });

  it('maps only the two allowed argument shapes to Cloud cases', () => {
    expect(selectMediaCase({ stages: '1,3,5' })).toMatchObject({ case: 'QA-11' });
    expect(
      selectMediaCase({ stages: '10', durationSeconds: '900', scenario: 'integrated-v0.0.8' }),
    ).toMatchObject({ case: 'QA-12' });
    expect(selectMediaCase({ stages: '10' })).toMatchObject({
      error: expect.stringContaining('unsupported'),
    });
    expect(selectMediaCase({ stages: '1,3' })).toMatchObject({ error: expect.any(String) });
    expect(
      selectMediaCase({ stages: '10', durationSeconds: '600', scenario: 'integrated-v0.0.8' }),
    ).toMatchObject({ error: expect.any(String) });
    const ten = planMediaLoad(
      { case: 'QA-12' },
      {
        ...preflight,
        maxRooms: 10,
        maxParticipants: 60,
        remainingMinutes: 1500,
        budgetReservation: { ...preflight.budgetReservation, participantMinutes: 1200 },
      },
    );
    expect(ten).toMatchObject({ ok: true });
    expect(
      planMediaLoad(
        { case: 'QA-12' },
        { ...preflight, maxRooms: 10, maxParticipants: 60, remainingMinutes: 1000 },
      ),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('900 + 300') });
  });
});

describe('stage judgement', () => {
  it('a clean 1-room stage passes and allows the 3-room stage', () => {
    const result = evaluateMediaStage(stage());
    expect(result).toMatchObject({ status: 'PASS', stopEscalation: false, holdGrants: false });
    expect(result.checks.every((c) => c.status === 'PASS')).toBe(true);
  });

  it('1-room effective latency over the limit stops the escalation: no 3-room run', () => {
    const result = evaluateMediaStage(stage({ effectLatencyMs: [200, 300, 400, 900, 1200] }));
    expect(result.status).toBe('FAIL');
    expect(result.stopEscalation).toBe(true);
    expect(result.checks.find((c) => c.name === 'effect.p95Ms')?.status).toBe('FAIL');
  });

  it('a 3-room stage with 15 of 18 sessions is reported below target, not as a 3-room result', () => {
    const result = evaluateMediaStage(stage({ rooms: 3, sessionsConnected: 15 }));
    const sessions = result.checks.find((c) => c.name === 'sessions.connected')!;
    expect(sessions.status).toBe('FAIL');
    expect(sessions.detail).toMatch(/15\/18 sessions: stage below target/);
    expect(result.stopEscalation).toBe(true);
  });

  it('one unresolved cleanup at 5 rooms locks new grants, keeps the reservation and blocks the next stage', () => {
    const result = evaluateMediaStage(
      stage({ rooms: 5, sessionsConnected: 30, unresolvedRetirements: 1 }),
    );
    expect(result).toMatchObject({ status: 'FAIL', stopEscalation: true, holdGrants: true });
    expect(result.checks.find((c) => c.name === 'cleanup.unresolvedRetirements')).toMatchObject({
      status: 'FAIL',
      value: 1,
      limit: 0,
    });
  });

  it('idle connections without the 5→6→7→6→5 movement are INCOMPLETE, and the boundary rule is 5 allow / 7 block / 6 keep', () => {
    const idle = evaluateMediaStage(stage({ audibility: [] }));
    expect(idle.status).toBe('INCOMPLETE');
    expect(idle.stopEscalation).toBe(true);
    expect(expectedAudibility({ distanceCells: 5, previouslyAllowed: false })).toBe('allowed');
    expect(expectedAudibility({ distanceCells: 7, previouslyAllowed: true })).toBe('blocked');
    expect(expectedAudibility({ distanceCells: 6, previouslyAllowed: true })).toBe('allowed');
    expect(expectedAudibility({ distanceCells: 6, previouslyAllowed: false })).toBe('blocked');
    const wrong = evaluateMediaStage(
      stage({ audibility: [{ distanceCells: 7, previouslyAllowed: true, observed: 'allowed' }] }),
    );
    expect(wrong.checks.find((c) => c.name === 'audibility.boundary')?.status).toBe('FAIL');
  });

  it('API budget and 429 are judged on the same stage as latency; a missing game-side judgement is INCOMPLETE, never PASS', () => {
    const api = evaluateMediaStage(stage({ apiCallsPer60s: [590, 650] }));
    expect(api.checks.find((c) => c.name === 'api.callsPer60s.max')).toMatchObject({
      status: 'FAIL',
      value: 650,
      limit: MEDIA_LOAD_THRESHOLDS.apiCallsPer60s,
    });
    const throttled = evaluateMediaStage(stage({ tooManyRequests: 1 }));
    expect(throttled.status).toBe('FAIL');
    const noGame = evaluateMediaStage(stage({ gameStageStatus: null }));
    expect(noGame.status).toBe('INCOMPLETE');
  });
});
