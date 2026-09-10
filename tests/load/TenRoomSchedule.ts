// F-18 / QA-12 ten-room integrated schedule (v0.0.8 §26.2): pure data and judgement. The
// schedule names what each minute of the 15-minute window must contain; `evaluateIntegrated`
// judges recorded windows against the G2 (management API) and G6 (effective media) targets on
// the same normal intervals, keeps transitional and reduced-session intervals apart, and never
// relaxes a threshold. No timers, no Cloud: tests/load/integrated-summary.test.ts checks fixtures.
import { describe, type Distribution } from './LoadStats.ts';
import { MEDIA_LOAD_THRESHOLDS } from './MediaLoadScenario.ts';

export const TEN_ROOM_TARGET = Object.freeze({
  rooms: 10,
  sessions: 60,
  durationSeconds: 900,
  scenario: 'integrated-v0.0.8',
  /** 60 sessions × 15 min = 900 participant-minutes, plus preparation/teardown/reconnect plan. */
  participantMinutes: 900,
  planningMinutes: 300,
});

export type ScheduleSegment = Readonly<{
  id: 'connect' | 'movement' | 'republish' | 'rematch';
  fromSecond: number;
  toSecond: number;
  /** What must be observed inside the segment for the run to count as integrated (G6). */
  required: readonly string[];
}>;

export const TEN_ROOM_SCHEDULE: readonly ScheduleSegment[] = Object.freeze([
  {
    id: 'connect',
    fromSecond: 0,
    toSecond: 180,
    required: [
      '60 sessions publish face+voice',
      'role/relationship markers reach Cloud',
      'connect API burst measured',
    ],
  },
  {
    id: 'movement',
    fromSecond: 180,
    toSecond: 480,
    required: [
      'all 10 rooms move 5→6→7→6→5 cells',
      'game input → policy → management API → new marker linked',
    ],
  },
  {
    id: 'republish',
    fromSecond: 480,
    toSecond: 660,
    required: [
      'standing pair republish (new SID)',
      'same-SID replaceTrack',
      'one full reconnect; 59-session gap timed separately',
    ],
  },
  {
    id: 'rematch',
    fromSecond: 660,
    toSecond: 900,
    required: [
      'simultaneous start / rematch with new matchId',
      'escape/capture/personal end',
      'full cleanup',
    ],
  },
]);

export type IntegratedWindow = Readonly<{
  /** Window start, seconds from the schedule origin; windows are 60 s wide. */
  atSecond: number;
  /** Tag decides which targets apply. Retagging a failed normal window is not allowed. */
  tag: 'normal' | 'transitional' | 'reduced' | 'destructive';
  concurrentSessions: number;
  apiCalls: number;
  tooManyRequests: number;
  effectLatencyMs: readonly number[];
  /** Game input → policy change events observed in this window (0 on an idle window). */
  policyChanges: number;
  movementCells: number;
}>;

export type IntegratedInput = Readonly<{
  windows: readonly IntegratedWindow[];
  unresolvedRetirements: number;
  /** Official usage confirmed after the run (minutes/bytes) or null when not reconciled. */
  officialAfter: Readonly<{
    remainingMinutes: number;
    remainingBytes: number;
    checkedAtEpochMs: number;
  }> | null;
  /** Segments where the required observations were actually recorded. */
  observedRequirements: readonly string[];
}>;

export type GateVerdict = Readonly<{
  gate: 'G2' | 'G6' | 'cleanup';
  status: 'PASS' | 'FAIL' | 'NOT_RUN';
  reasons: readonly string[];
}>;

export type IntegratedSummary = Readonly<{
  normalWindows: number;
  transitionalWindows: number;
  reducedWindows: number;
  destructiveWindows: number;
  /** Seconds in which 60 sessions were measured concurrently (never estimated from one room). */
  measuredSixtySeconds: number;
  apiCallsMax: number | null;
  effectLatency: Distribution | null;
  gates: readonly GateVerdict[];
  publishHold: boolean;
}>;

export function evaluateIntegrated(input: IntegratedInput): IntegratedSummary {
  const normal = input.windows.filter((w) => w.tag === 'normal');
  const transitional = input.windows.filter((w) => w.tag === 'transitional');
  const reduced = input.windows.filter((w) => w.tag === 'reduced');
  const destructive = input.windows.filter((w) => w.tag === 'destructive');
  const sixty = input.windows.filter(
    (w) => w.tag !== 'destructive' && w.concurrentSessions >= TEN_ROOM_TARGET.sessions,
  );
  const effectSamples = normal.flatMap((w) => w.effectLatencyMs);
  const effect = effectSamples.length ? describe(effectSamples) : null;
  const apiMax = normal.length ? Math.max(...normal.map((w) => w.apiCalls)) : null;

  // G2: whole-server API on normal windows only, with no emergency ceiling and no 429.
  const g2: string[] = [];
  if (normal.length === 0) g2.push('no normal window recorded');
  if (apiMax !== null && apiMax > MEDIA_LOAD_THRESHOLDS.apiCallsPer60s)
    g2.push(
      `api calls ${apiMax}/60s > ${MEDIA_LOAD_THRESHOLDS.apiCallsPer60s} (900 is not an accepted ceiling)`,
    );
  const tooMany = normal.reduce((s, w) => s + w.tooManyRequests, 0);
  if (tooMany > 0) g2.push(`${tooMany} × 429 on normal windows`);
  if (effect === null) g2.push('effective latency not measured');
  else {
    if (effect.p95 > MEDIA_LOAD_THRESHOLDS.effectP95Ms)
      g2.push(`effect p95 ${effect.p95}ms > ${MEDIA_LOAD_THRESHOLDS.effectP95Ms}`);
    if (effect.p99 > MEDIA_LOAD_THRESHOLDS.effectP99Ms)
      g2.push(`effect p99 ${effect.p99}ms > ${MEDIA_LOAD_THRESHOLDS.effectP99Ms}`);
  }

  // G6: sixty concurrent sessions actually measured, actually moving, with every segment observed.
  const g6: string[] = [];
  const measuredSixtySeconds = sixty.length * 60;
  if (sixty.length === 0) g6.push('60 concurrent sessions never measured');
  const activity = normal.reduce((s, w) => s + w.policyChanges + w.movementCells, 0);
  if (normal.length > 0 && activity === 0)
    g6.push('idle connections only: no movement or policy change');
  for (const segment of TEN_ROOM_SCHEDULE)
    for (const requirement of segment.required)
      if (!input.observedRequirements.includes(requirement))
        g6.push(`${segment.id}: ${requirement} not observed`);

  // Cleanup and official reconciliation gate publication, never the concurrency result.
  const cleanup: string[] = [];
  if (input.unresolvedRetirements > 0)
    cleanup.push(`${input.unresolvedRetirements} unresolved retirements`);
  if (!input.officialAfter) cleanup.push('official usage not reconciled after the run');

  const verdict = (gate: GateVerdict['gate'], reasons: string[], ran: boolean): GateVerdict => ({
    gate,
    status: !ran ? 'NOT_RUN' : reasons.length ? 'FAIL' : 'PASS',
    reasons,
  });
  return {
    normalWindows: normal.length,
    transitionalWindows: transitional.length,
    reducedWindows: reduced.length,
    destructiveWindows: destructive.length,
    measuredSixtySeconds,
    apiCallsMax: apiMax,
    effectLatency: effect,
    gates: [
      verdict('G2', g2, input.windows.length > 0),
      verdict('G6', g6, input.windows.length > 0),
      verdict('cleanup', cleanup, true),
    ],
    publishHold: cleanup.length > 0,
  };
}
