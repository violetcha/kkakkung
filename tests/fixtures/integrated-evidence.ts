// Synthetic stored measurements; not an actual Cloud run.
import {
  TEN_ROOM_SCHEDULE,
  type IntegratedInput,
  type IntegratedWindow,
} from '../load/TenRoomSchedule.ts';

export const allRequirements = TEN_ROOM_SCHEDULE.flatMap((s) => s.required);
export const run = {
  sourceCommit: 'a'.repeat(40),
  startedAtEpochMs: 1_800_000_000_000,
  endedAtEpochMs: 1_800_000_960_000,
};
export const latency = (p99: number) =>
  Array.from({ length: 100 }, (_, i) => (i < 99 ? 100 + i * 2 : p99));

export function window(atSecond: number, over: Partial<IntegratedWindow> = {}): IntegratedWindow {
  return {
    atSecond,
    durationSeconds: 60,
    tag: 'normal',
    concurrentSessions: 60,
    rooms: Array.from({ length: 10 }, (_, room) => ({
      roomId: `room-${room}`,
      sessionIds: Array.from({ length: 6 }, (_, session) => `room-${room}-session-${session}`),
    })),
    apiCalls: 400,
    apiRequestAtSeconds: Array.from(
      { length: Math.max(0, over.apiCalls ?? 400) },
      (_, i) => atSecond + ((i + 0.5) * (over.durationSeconds ?? 60)) / (over.apiCalls ?? 400),
    ),
    tooManyRequests: 0,
    effectLatencyMs: latency(600),
    policyChanges: 40,
    movementCells: 300,
    ...over,
  };
}

export function input(over: Partial<IntegratedInput> = {}): IntegratedInput {
  return {
    run,
    windows: Array.from({ length: 15 }, (_, i) => window(i * 60)),
    unresolvedRetirements: 0,
    officialAfter: {
      remainingMinutes: 3000,
      remainingBytes: 1e12,
      checkedAtEpochMs: run.endedAtEpochMs + 1,
    },
    observedRequirements: allRequirements,
    ...over,
  };
}
