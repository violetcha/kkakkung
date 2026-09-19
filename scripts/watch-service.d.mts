// Type surface of scripts/watch-service.mjs for tests/contracts/service-watch.test.ts (tsconfig.qa.json).
export const WATCH_POLICY: Readonly<{
  downAfterChecks: number;
  remindEveryMs: number;
  httpTimeoutMs: number;
  sendTimeoutMs: number;
}>;
export const WATCH_TARGETS: Readonly<{ game: string; web: string; liveUrl: string }>;

export type WatchContainer = Readonly<{
  id: string;
  running: boolean;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none' | string;
  restartCount: number;
}>;
/** null: the container does not exist. undefined: Docker could not be asked. */
export type WatchObservation = Readonly<{
  game: WatchContainer | null | undefined;
  web: Readonly<{ running: boolean }> | null | undefined;
  live: Readonly<{ ok: boolean; status: number | null }>;
}>;
export type WatchState = Readonly<{
  version: 1;
  failures: number;
  downSinceMs: number | null;
  announcedDown: boolean;
  remindedAtMs: number | null;
  game: Readonly<{ id: string; restartCount: number }> | null;
  checkedAtMs?: number;
  problems?: readonly string[];
}>;
export type WatchNoticeKind = 'DOWN' | 'STILL_DOWN' | 'RECOVERED' | 'RESTARTED' | 'TEST';
export const INITIAL_WATCH_STATE: WatchState;

export function summarize(observation: WatchObservation): { healthy: boolean; problems: string[] };
export function formatWatchNotice(
  kind: WatchNoticeKind,
  input: Readonly<{
    label: string;
    failures?: number;
    lastedMs?: number;
    problems?: readonly string[];
    delta?: number;
    restartCount?: number;
  }>,
): string;
export function decideWatch(
  previous: unknown,
  observation: WatchObservation,
  nowMs: number,
  options?: Readonly<{
    label?: string;
    policy?: Partial<{ downAfterChecks: number; remindEveryMs: number }>;
  }>,
): {
  healthy: boolean;
  problems: string[];
  notices: { kind: WatchNoticeKind; text: string }[];
  next: WatchState;
};
