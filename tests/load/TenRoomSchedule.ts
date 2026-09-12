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

export type RoomObservation = Readonly<{
  /** Opaque run-local labels from the collector, never room codes or authentication tokens. */
  roomId: string;
  /** Participants continuously present for the entire interval, not the union of arrivals. */
  sessionIds: readonly string[];
}>;

export type IntegratedWindow = Readonly<{
  /** Window start, seconds from the schedule origin. */
  atSecond: number;
  /** Complete API windows are 60 s. A partial final interval cannot certify a full API minute. */
  durationSeconds: number;
  /** Tag decides which targets apply. Retagging a failed normal window is not allowed. */
  tag: 'normal' | 'transitional' | 'reduced' | 'destructive';
  concurrentSessions: number;
  rooms: readonly RoomObservation[];
  apiCalls: number;
  /** Actual whole-server dispatch times, seconds from the same run origin. */
  apiRequestAtSeconds: readonly number[];
  tooManyRequests: number;
  effectLatencyMs: readonly number[];
  /** Game input → policy change events observed in this window (0 on an idle window). */
  policyChanges: number;
  movementCells: number;
}>;

export type IntegratedInput = Readonly<{
  run: Readonly<{ sourceCommit: string; startedAtEpochMs: number; endedAtEpochMs: number }>;
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
  const invalid = validateIntegratedEvidence(input);
  if (invalid.length)
    return {
      normalWindows: 0,
      transitionalWindows: 0,
      reducedWindows: 0,
      destructiveWindows: 0,
      measuredSixtySeconds: 0,
      apiCallsMax: null,
      effectLatency: null,
      gates: ['G2', 'G6', 'cleanup'].map((gate) => ({
        gate: gate as GateVerdict['gate'],
        status: 'FAIL',
        reasons: invalid,
      })),
      publishHold: true,
    };
  const normal = input.windows.filter((w) => w.tag === 'normal');
  const transitional = input.windows.filter((w) => w.tag === 'transitional');
  const reduced = input.windows.filter((w) => w.tag === 'reduced');
  const destructive = input.windows.filter((w) => w.tag === 'destructive');
  const sixty = input.windows.filter(
    (w) =>
      (w.tag === 'normal' || w.tag === 'transitional') &&
      w.concurrentSessions === TEN_ROOM_TARGET.sessions &&
      w.rooms.length === TEN_ROOM_TARGET.rooms &&
      w.rooms.every((room) => room.sessionIds.length === 6),
  );
  const effectSamples = normal.flatMap((w) => w.effectLatencyMs);
  const effect = effectSamples.length ? describe(effectSamples) : null;
  const apiMax = normal.length
    ? rollingApiMaximum(normal.flatMap((w) => w.apiRequestAtSeconds))
    : null;

  // G2: whole-server API on normal windows only, with no emergency ceiling and no 429.
  const g2: string[] = [];
  if (normal.length === 0) g2.push('no normal window recorded');
  if (normal.some((w) => w.durationSeconds !== 60))
    g2.push('partial normal window cannot certify the 60s management API limit');
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
  const measuredSixtySeconds = sixty.reduce((seconds, w) => seconds + w.durationSeconds, 0);
  if (measuredSixtySeconds < TEN_ROOM_TARGET.durationSeconds)
    g6.push(
      `10 rooms / 60 concurrent sessions measured for ${measuredSixtySeconds}s < ${TEN_ROOM_TARGET.durationSeconds}s`,
    );
  if (
    new Set(sixty.flatMap((w) => w.rooms.map((room) => room.roomId))).size > TEN_ROOM_TARGET.rooms
  )
    g6.push('the measured run must retain the same 10 room identities across rematches');
  const activity = normal.reduce((s, w) => s + w.policyChanges + w.movementCells, 0);
  if (normal.length > 0 && activity === 0)
    g6.push('idle connections only: no movement or policy change');
  for (const segment of TEN_ROOM_SCHEDULE)
    for (const requirement of segment.required)
      if (!input.observedRequirements.includes(requirement))
        g6.push(`${segment.id}: ${requirement} not observed`);

  // Cleanup and official reconciliation gate publication, never the concurrency result.
  const cleanup: string[] = [];
  if (!Number.isSafeInteger(input.unresolvedRetirements) || input.unresolvedRetirements < 0)
    cleanup.push('unresolved retirement count missing or invalid');
  else if (input.unresolvedRetirements > 0)
    cleanup.push(`${input.unresolvedRetirements} unresolved retirements`);
  const official = input.officialAfter;
  if (
    !official ||
    !Number.isFinite(official.remainingMinutes) ||
    official.remainingMinutes < 0 ||
    !Number.isSafeInteger(official.remainingBytes) ||
    official.remainingBytes < 0 ||
    !Number.isSafeInteger(official.checkedAtEpochMs) ||
    official.checkedAtEpochMs < input.run.endedAtEpochMs
  )
    cleanup.push('official usage not reconciled after the run');

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
    publishHold: g2.length > 0 || g6.length > 0 || cleanup.length > 0,
  };
}

/** Validate parsed JSON before arithmetic. Invalid numbers must never pass comparisons via NaN. */
export function validateIntegratedEvidence(input: unknown): string[] {
  if (!record(input) || !Array.isArray(input.windows)) return ['windows.json missing or invalid'];
  const run = input.run;
  if (
    !record(run) ||
    typeof run.sourceCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(run.sourceCommit) ||
    !uint(run.startedAtEpochMs) ||
    run.startedAtEpochMs === 0 ||
    !uint(run.endedAtEpochMs) ||
    run.endedAtEpochMs <= run.startedAtEpochMs
  )
    return ['run.json must identify the source commit and actual measurement start/end'];
  if (
    !Array.isArray(input.observedRequirements) ||
    !input.observedRequirements.every((value) => typeof value === 'string')
  )
    return ['requirements.json must contain observation names'];
  if (input.windows.length > 3600) return ['too many measurement intervals'];
  const reasons: string[] = [];
  for (let index = 0; index < input.windows.length; index++) {
    const w: unknown = input.windows[index];
    if (!record(w)) {
      reasons.push(`window ${index}: invalid object`);
      continue;
    }
    const bad = (reason: string) => reasons.push(`window ${index}: ${reason}`);
    if (
      !uint(w.atSecond) ||
      !uint(w.durationSeconds) ||
      w.durationSeconds < 1 ||
      w.durationSeconds > 60
    )
      bad('invalid measured interval');
    if (!['normal', 'transitional', 'reduced', 'destructive'].includes(String(w.tag)))
      bad('invalid tag');
    for (const name of [
      'concurrentSessions',
      'apiCalls',
      'tooManyRequests',
      'policyChanges',
      'movementCells',
    ])
      if (!uint(w[name])) bad(`invalid ${name}`);
    if (
      !Array.isArray(w.apiRequestAtSeconds) ||
      w.apiRequestAtSeconds.length > 100_000 ||
      w.apiRequestAtSeconds.length !== w.apiCalls ||
      !w.apiRequestAtSeconds.every(
        (value) =>
          typeof value === 'number' &&
          Number.isFinite(value) &&
          typeof w.atSecond === 'number' &&
          typeof w.durationSeconds === 'number' &&
          value >= w.atSecond &&
          value < w.atSecond + w.durationSeconds,
      )
    )
      bad('management API timestamps missing, outside interval, or inconsistent with count');
    if (
      !Array.isArray(w.effectLatencyMs) ||
      w.effectLatencyMs.length > 100_000 ||
      !w.effectLatencyMs.every(
        (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
      )
    )
      bad('invalid effective latency samples');
    if (!Array.isArray(w.rooms) || w.rooms.length > TEN_ROOM_TARGET.rooms) {
      bad('room observations missing or invalid');
      continue;
    }
    const rooms = new Set<string>();
    const sessions = new Set<string>();
    let count = 0;
    for (const room of w.rooms) {
      if (!record(room) || !label(room.roomId) || !Array.isArray(room.sessionIds)) {
        bad('invalid room identity or session observations');
        continue;
      }
      if (rooms.has(room.roomId)) bad('duplicate room identity');
      rooms.add(room.roomId);
      if (room.sessionIds.length < 1 || room.sessionIds.length > 6)
        bad('room must contain 1 to 6 sessions');
      for (const session of room.sessionIds) {
        if (!label(session)) bad('invalid session identity');
        else {
          if (sessions.has(session)) bad('session counted more than once');
          sessions.add(session);
        }
        count++;
      }
    }
    if (count !== w.concurrentSessions) bad('session total differs from room observations');
    if (w.tag === 'normal' && count !== TEN_ROOM_TARGET.sessions)
      bad('normal window must have 60 sessions');
    if (w.tag === 'reduced' && count >= TEN_ROOM_TARGET.sessions)
      bad('reduced window must have fewer than 60 sessions');
  }
  if (reasons.length) return reasons;
  // Missing time must be recorded as a reduced/destructive interval, never silently omitted.
  let end = 0;
  const windows = input.windows as IntegratedWindow[];
  for (const w of [...windows].sort((a, b) => a.atSecond - b.atSecond)) {
    if (w.atSecond < end) reasons.push(`overlapping or duplicate interval at ${w.atSecond}s`);
    if (w.atSecond > end) reasons.push(`unobserved interval from ${end}s to ${w.atSecond}s`);
    end = Math.max(end, w.atSecond + w.durationSeconds);
  }
  if (!Number.isSafeInteger(end) || end * 1000 > run.endedAtEpochMs - run.startedAtEpochMs)
    reasons.push('measurement intervals exceed the recorded run duration');
  return reasons;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function uint(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function label(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}

function rollingApiMaximum(times: readonly number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let maximum = 0;
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    while (sorted[right]! - sorted[left]! >= 60) left++;
    maximum = Math.max(maximum, right - left + 1);
  }
  return maximum;
}
