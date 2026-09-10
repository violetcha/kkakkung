// Type surface of scripts/collect-observability.mjs for tests/contracts/observability.test.ts (tsconfig.qa.json).
export const REGISTERED_METRICS: Readonly<Record<string, 'count' | 'ms' | 'bytes' | 'ratio'>>;
export const EVENT_NAMES: readonly string[];
export const ALERT_THRESHOLDS: Readonly<{
  mediaApiTotal60sNearLimit: number;
  mediaApi429: number;
  mediaPolicyResponseLatencyMs: number;
  mediaRetirementUnresolvedMs: number;
}>;
export type ScriptValidation =
  | Readonly<{ ok: true; sample: Record<string, unknown> }>
  | Readonly<{ ok: false; reason: string; field?: string }>;
export function validateSample(input: unknown): ScriptValidation;
export function quantile(values: readonly number[], p: number): number | null;
export function describe(values: readonly number[]): Record<string, number>;
export function summarizeTickRounds(
  samples: readonly Record<string, unknown>[],
): Record<string, unknown>;
export function evaluateThresholds(
  samples: readonly Record<string, unknown>[],
): Record<string, boolean>;
export function collect(lines: readonly string[]): Record<string, unknown>;
