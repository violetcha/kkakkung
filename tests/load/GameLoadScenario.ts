// F-14 / QA-10. Stage plan and pass/fail evaluation for the 1→3→5→10 room game-only load run.
// Pure data and functions: importing this file starts nothing. Cloud is never involved; a PASS
// here is a game-server diagnosis, not the G6 media integration gate.
import {
  combinedRounds,
  describe,
  quantile,
  slopePerMinute,
  type Distribution,
} from './LoadStats.ts';

export const LOAD_THRESHOLDS = Object.freeze({
  /** Ten rooms combined per-round tick duration (ms). */
  tickCombinedP95Ms: 20,
  tickCombinedP99Ms: 40,
  /** Event-loop / tick lag (ms). */
  lagP95Ms: 20,
  /** Command acceptance: client send → `command-result` receipt (ms). */
  commandAckP95Ms: 200,
  /** Idle connections are not load: every client must keep sending game input. */
  minCommandsPerClientPerMinute: 60,
  /** A round must end (deadline 180 s) and a new match must start well inside this bound. */
  maxRoundSeconds: 200,
  overloads: 0,
  aborts: 0,
});

export type StagePlan = Readonly<{
  /** Room counts in escalation order, e.g. [1, 3, 5, 10]. */
  stages: readonly number[];
  /** Seconds each non-final stage is observed. */
  stageDurationSeconds: number;
  /** Seconds the final stage is observed; the 30-minute diagnosis needs 1800. */
  finalDurationSeconds: number;
  clientsPerRoom: 6;
}>;

export function buildPlan(input: {
  stages?: readonly number[];
  stageDurationSeconds?: number;
  finalDurationSeconds?: number;
}): StagePlan {
  const stages = input.stages ?? [1, 3, 5, 10];
  if (stages.length === 0 || stages.some((s) => !Number.isInteger(s) || s < 1 || s > 10))
    throw new RangeError('stages must be 1..10 room counts');
  for (let i = 1; i < stages.length; i++)
    if (stages[i]! <= stages[i - 1]!) throw new RangeError('stages must strictly increase');
  const stageDurationSeconds = input.stageDurationSeconds ?? 60;
  const finalDurationSeconds = input.finalDurationSeconds ?? stageDurationSeconds;
  if (stageDurationSeconds < 1 || finalDurationSeconds < 1)
    throw new RangeError('durations must be positive');
  return { stages, stageDurationSeconds, finalDurationSeconds, clientsPerRoom: 6 };
}

export function stageDuration(plan: StagePlan, index: number): number {
  return index === plan.stages.length - 1 ? plan.finalDurationSeconds : plan.stageDurationSeconds;
}

export type ClientStageStats = Readonly<{
  playerId: string;
  roomIndex: number;
  commandsSent: number;
  ackLatenciesMs: readonly number[];
  receiptsRejected: number;
  outcomesApplied: number;
  outcomesRejected: number;
  outcomesCanceled: number;
  /** Wall-clock ms at which a new matchId was observed. */
  matchStartsMs: readonly number[];
  abortsSeen: number;
  abortReasons: readonly string[];
  phasesSeen: readonly string[];
}>;

export type ServerStageStats = Readonly<{
  /** Coordinator `eventLoop.lag` samples (per tick, ms). This is the judged lag. */
  lagMs: readonly number[];
  /** Diagnostic process histogram p99 of event-loop delay per 5 s window; informational only. */
  eventLoopDelayP99Ms?: readonly number[];
  /** Diagnostic server-process CPU ratio (0–1 of wall time) per 5 s window; informational only. */
  cpuRatio?: readonly number[];
  /** `tick.duration` samples: value ms with the round timestamp; empty until B emits them. */
  tickDuration: readonly Readonly<{ atMs: number; value: number }>[];
  overloads: number;
  catchups: number;
  rss: readonly Readonly<{ atMs: number; value: number }>[];
}>;

export type StageInput = Readonly<{
  rooms: number;
  durationSeconds: number;
  clients: readonly ClientStageStats[];
  server: ServerStageStats | null;
  /** Set when the diagnostic server process exited during the stage; the stage is then FAIL. */
  serverExit?: Readonly<{ code: number | null; afterSeconds: number }> | null;
}>;

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_MEASURED';

export type StageCheck = Readonly<{
  name: string;
  status: CheckStatus;
  value: number | null;
  limit: number | null;
  detail?: string;
}>;

export type StageResult = Readonly<{
  rooms: number;
  durationSeconds: number;
  clients: number;
  status: 'PASS' | 'FAIL' | 'INCOMPLETE';
  /** True when escalation to a larger stage must not happen. */
  stopEscalation: boolean;
  checks: readonly StageCheck[];
  distributions: Readonly<{
    commandAckMs: Distribution;
    lagMs: Distribution | null;
    tickCombinedMs: Distribution | null;
    rssSlopeBytesPerMinute: number | null;
    eventLoopDelayP99Ms: Distribution | null;
    serverCpuRatio: Distribution | null;
  }>;
}>;

function check(
  name: string,
  value: number | null,
  limit: number | null,
  ok: (v: number) => boolean,
  detail?: string,
): StageCheck {
  if (value === null || Number.isNaN(value))
    return { name, status: 'NOT_MEASURED', value: null, limit, detail };
  return { name, status: ok(value) ? 'PASS' : 'FAIL', value, limit, detail };
}

/** Longest gap between consecutive match starts (or since the last start to the stage end). */
export function longestRoundSeconds(
  matchStartsMs: readonly number[],
  stageEndMs: number,
): number | null {
  if (matchStartsMs.length === 0) return null;
  const sorted = [...matchStartsMs].sort((a, b) => a - b);
  let longest = 0;
  for (let i = 1; i < sorted.length; i++) longest = Math.max(longest, sorted[i]! - sorted[i - 1]!);
  longest = Math.max(longest, stageEndMs - sorted.at(-1)!);
  return longest / 1000;
}

export function evaluateStage(input: StageInput, stageEndMs: number): StageResult {
  const expectedClients = input.rooms * 6;
  const acks = input.clients.flatMap((c) => c.ackLatenciesMs);
  const commandAck = describe(acks);
  const minutes = input.durationSeconds / 60;
  const perClientPerMinute = input.clients.map((c) => c.commandsSent / minutes);
  const idleFloor = perClientPerMinute.length ? Math.min(...perClientPerMinute) : null;
  const aborts = input.clients.reduce((sum, c) => sum + c.abortsSeen, 0);
  const longestRound = input.clients.reduce<number | null>((worst, c) => {
    const r = longestRoundSeconds(c.matchStartsMs, stageEndMs);
    return r === null ? worst : worst === null ? r : Math.max(worst, r);
  }, null);
  const lag = input.server ? describe(input.server.lagMs) : null;
  const tickCombined =
    input.server && input.server.tickDuration.length > 0
      ? describe(combinedRounds(input.server.tickDuration))
      : null;
  const rssSlope =
    input.server && input.server.rss.length >= 2 ? slopePerMinute(input.server.rss) : null;

  const checks: StageCheck[] = [
    check(
      'server.alive',
      input.serverExit ? 0 : 1,
      1,
      (v) => v === 1,
      input.serverExit
        ? `server process exited code=${input.serverExit.code} after ${input.serverExit.afterSeconds.toFixed(0)}s`
        : undefined,
    ),
    check('clients.connected', input.clients.length, expectedClients, (v) => v === expectedClients),
    check(
      'input.commandsPerClientPerMinute.min',
      idleFloor,
      LOAD_THRESHOLDS.minCommandsPerClientPerMinute,
      (v) => v >= LOAD_THRESHOLDS.minCommandsPerClientPerMinute,
      'idle connections are not load',
    ),
    check(
      'command.ack.p95Ms',
      acks.length ? commandAck.p95 : null,
      LOAD_THRESHOLDS.commandAckP95Ms,
      (v) => v <= LOAD_THRESHOLDS.commandAckP95Ms,
      'send → command-result receipt; not the 9/6-tick action completion',
    ),
    check(
      'round.longestSeconds',
      longestRound,
      LOAD_THRESHOLDS.maxRoundSeconds,
      (v) => v <= LOAD_THRESHOLDS.maxRoundSeconds,
      'a new matchId must appear within 200 s; no endless match',
    ),
    check(
      'match.aborts',
      aborts,
      LOAD_THRESHOLDS.aborts,
      (v) => v === 0,
      [...new Set(input.clients.flatMap((c) => c.abortReasons))].join(',') || undefined,
    ),
    check(
      'tick.overloads',
      input.server ? input.server.overloads : null,
      LOAD_THRESHOLDS.overloads,
      (v) => v === 0,
    ),
    check(
      'eventLoop.lag.p95Ms',
      lag && lag.count ? lag.p95 : null,
      LOAD_THRESHOLDS.lagP95Ms,
      (v) => v <= LOAD_THRESHOLDS.lagP95Ms,
    ),
    check(
      'tick.combined.p95Ms',
      tickCombined ? tickCombined.p95 : null,
      LOAD_THRESHOLDS.tickCombinedP95Ms,
      (v) => v <= LOAD_THRESHOLDS.tickCombinedP95Ms,
      'requires tick.duration samples from B (F-REQ-10)',
    ),
    check(
      'tick.combined.p99Ms',
      tickCombined ? tickCombined.p99 : null,
      LOAD_THRESHOLDS.tickCombinedP99Ms,
      (v) => v <= LOAD_THRESHOLDS.tickCombinedP99Ms,
      'requires tick.duration samples from B (F-REQ-10)',
    ),
  ];
  const failed = checks.some((c) => c.status === 'FAIL');
  const unmeasured = checks.some((c) => c.status === 'NOT_MEASURED');
  const status = failed ? 'FAIL' : unmeasured ? 'INCOMPLETE' : 'PASS';
  // Only structural failures stop the escalation: a dead server, an overload, an aborted match
  // or missing clients would make larger stages meaningless. Threshold misses (lag, ack) fail the stage
  // but the run continues so 3/5/10-room measurements still exist for the report.
  const stopEscalation =
    failed &&
    checks.some(
      (c) =>
        c.status === 'FAIL' &&
        (c.name === 'server.alive' ||
          c.name === 'tick.overloads' ||
          c.name === 'match.aborts' ||
          c.name === 'clients.connected'),
    );
  return {
    rooms: input.rooms,
    durationSeconds: input.durationSeconds,
    clients: input.clients.length,
    status,
    stopEscalation,
    checks,
    distributions: {
      commandAckMs: commandAck,
      lagMs: lag,
      tickCombinedMs: tickCombined,
      rssSlopeBytesPerMinute: rssSlope,
      eventLoopDelayP99Ms:
        input.server && input.server.eventLoopDelayP99Ms && input.server.eventLoopDelayP99Ms.length
          ? describe(input.server.eventLoopDelayP99Ms)
          : null,
      serverCpuRatio:
        input.server && input.server.cpuRatio && input.server.cpuRatio.length
          ? describe(input.server.cpuRatio)
          : null,
    },
  };
}

/** The p99 of a fixture with a slow top 1 % must reflect that tail; averages never gate a stage. */
export function tailIsVisible(values: readonly number[]): boolean {
  return quantile(values, 0.99) >= Math.max(...values) - Number.EPSILON;
}
