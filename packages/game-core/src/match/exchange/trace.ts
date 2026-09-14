import type { TracePoint } from '../core-types.js';
import type { MatchState } from '../state.js';
import type { Cell } from '../types.js';

/**
 * A scheduled tagger trace. `point` is a midpoint, so it is not a Cell: on
 * adjacent cells the coordinates land on halves. Neither the source players
 * nor their identities are stored here.
 */
export type PendingTrace = Readonly<{
  markerId: string;
  kind: 'exchange' | 'sensor' | 'trap';
  point: TracePoint;
  occurredTick: number;
  publishTick: number;
  expiresTick: number;
}>;

export type PendingTraces = ReadonlyMap<string, PendingTrace>;

export type TraceReleaseResult = Readonly<{
  state: MatchState;
  /** Traces to publish at this tick, in schedule order. */
  due: readonly PendingTrace[];
}>;

/**
 * Midpoint of the two cells of one event. The same cell gives that cell's
 * centre; orthogonally adjacent cells give a coordinate on a half step.
 */
export function midpointOf(a: Cell, b: Cell): TracePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Schedules one delayed trace (KN-08). The completion id keys the schedule, so
 * a repeated completion neither books nor sends a second marker. The point is
 * frozen here and never follows the players' later movement. The delay and the
 * display window come from the match's tuning, like every other rule value.
 */
export function scheduleTrace(
  state: MatchState,
  entry: Readonly<{
    markerId: string;
    kind: PendingTrace['kind'];
    point: TracePoint;
    occurredTick: number;
    /** Ticks between the event and its publication; defaults to the tuned delay. */
    delayTicks?: number;
  }>,
): MatchState {
  if (state.traces.has(entry.markerId)) return state;
  const publishTick = entry.occurredTick + (entry.delayTicks ?? state.tuning.traceDelayTicks);
  const traces = new Map(state.traces);
  traces.set(
    entry.markerId,
    Object.freeze({
      markerId: entry.markerId,
      kind: entry.kind,
      point: Object.freeze({ x: entry.point.x, y: entry.point.y }),
      occurredTick: entry.occurredTick,
      publishTick,
      expiresTick: publishTick + state.tuning.traceVisibleTicks,
    }),
  );
  return { ...state, traces };
}

/**
 * Takes every trace whose publish tick has come. Each one leaves the schedule
 * exactly once, so it can never be sent twice; one whose display window has
 * already passed is dropped without being published.
 */
export function releaseTraces(state: MatchState, tick: number): TraceReleaseResult {
  if (state.traces.size === 0) return { state, due: [] };
  const due: PendingTrace[] = [];
  let traces: Map<string, PendingTrace> | null = null;
  for (const trace of state.traces.values()) {
    if (trace.publishTick > tick) continue;
    traces ??= new Map(state.traces);
    traces.delete(trace.markerId);
    if (tick < trace.expiresTick) due.push(trace);
  }
  if (!traces) return { state, due: [] };
  return { state: { ...state, traces }, due };
}
