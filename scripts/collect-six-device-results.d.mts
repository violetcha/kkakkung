// Type surface of scripts/collect-six-device-results.mjs for tests/contracts/six-device-report.test.ts.
export const REQUIRED_COVERAGE: readonly string[];
export const PRODUCT_DECISION_PENDING: readonly string[];
export const FPS_TARGET: Readonly<{ mid: number; low: number }>;
export type SixDeviceResult = Readonly<{
  status: 'PASS' | 'FAIL' | 'INCOMPLETE';
  issues: string[];
  incomplete: string[];
  summary: Readonly<{
    devices: number;
    realDevices: number;
    matches: number;
    coverage: Readonly<{ required: number; covered: number; missing: string[] }>;
    pendingUsed: string[];
    fps: Record<string, { avg: number; target: number | null }>;
    sourceCommit: string | null;
  }>;
}>;
export function validateSixDeviceRecords(input: {
  devices: unknown;
  matches: unknown;
}): SixDeviceResult;
