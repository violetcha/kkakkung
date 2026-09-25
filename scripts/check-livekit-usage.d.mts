export const USAGE_POLICY: Readonly<{
  pageLimit: number;
  maxPages: number;
  apiTimeoutMs: number;
  sendTimeoutMs: number;
  remindEveryMs: number;
  maxCoverageGapMs: number;
}>;

export const INITIAL_USAGE_STATE: Readonly<{
  version: 1;
  periodId: string | null;
  baselineMinutes: number | null;
  sessions: Readonly<Record<string, Readonly<{ minutes: number; observedAtMs: number }>>>;
  lastSuccessfulAtMs: number | null;
  lastNoticeAtMs: number | null;
  lastLevel: 'normal' | 'warning' | 'critical' | 'exhausted';
  lastFailureCode: string | null;
  lastFailureNoticeAtMs: number | null;
}>;

export class UsageMonitorError extends Error {
  readonly code: string;
}

export function monthPeriodId(atMs: number): string;
export function analyticsWindow(atMs: number): { start: string; end: string };
export function readUsageState(value: unknown): typeof INITIAL_USAGE_STATE;
export function thresholdsFromEnv(env?: Readonly<Record<string, string | undefined>>): {
  allowanceMinutes: number;
  warningMinutes: number;
  criticalMinutes: number;
};
export function summarizeUsage(
  state: unknown,
  atMs: number,
  thresholds: { allowanceMinutes: number; warningMinutes: number; criticalMinutes: number },
): {
  periodId: string;
  baselineMinutes: number;
  observedMinutes: number;
  remainingMinutes: number;
  level: 'normal' | 'warning' | 'critical' | 'exhausted';
  lastSuccessfulAtMs: number | null;
};
export function mergeUsage(
  state: unknown,
  periodId: string,
  records: readonly { sessionId: string; minutes: number }[],
  atMs: number,
  baselineMinutes?: number,
): typeof INITIAL_USAGE_STATE;
export function decideUsage(
  previous: unknown,
  current: unknown,
  atMs: number,
  options?: Readonly<{
    label?: string;
    source?: string;
    thresholds: { allowanceMinutes: number; warningMinutes: number; criticalMinutes: number };
    remindEveryMs?: number;
  }>,
): {
  current: ReturnType<typeof summarizeUsage>;
  notices: { kind: string; text: string }[];
  next: typeof INITIAL_USAGE_STATE;
};
export function formatUsageNotice(
  current: ReturnType<typeof summarizeUsage>,
  options?: Readonly<{
    label?: string;
    source?: string;
    thresholds?: { allowanceMinutes: number; warningMinutes: number; criticalMinutes: number };
  }>,
): string;
export function collectUsage(
  options: Readonly<{
    projectId: string;
    apiKey: string;
    apiSecret: string;
    nowMs: number;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }>,
): Promise<{
  window: { start: string; end: string };
  records: { sessionId: string; minutes: number }[];
}>;
export function failureState<T extends object>(
  previous: T,
  code: string,
  atMs: number,
): T & { lastFailureCode: string; lastFailureNoticeAtMs: number };
export function formatFailureNotice(code: string, label?: string): string;
