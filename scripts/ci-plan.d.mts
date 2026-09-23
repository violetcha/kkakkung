// Type surface of scripts/ci-plan.mjs for tests/contracts/ci-plan.test.ts (tsconfig.qa.json).
export type PlanStep = Readonly<{
  id: string;
  commands: readonly (readonly string[])[];
  env?: Readonly<Record<string, string>>;
}>;
export const HEAVY_VITEST: readonly string[];
export const DP06_LOCAL_VITEST: string;
export const RENDER_E2E: string;
export const WEB_PATHS: readonly string[];
export const RENDER_PATHS: readonly string[];
export const ASSET_PATHS: readonly string[];
export const DP06_PATHS: readonly string[];
export function docsOnly(files: readonly string[]): boolean;
export function planChecks(input: {
  mode: 'mr' | 'deploy';
  changed: readonly string[] | null;
}): PlanStep[];
export function changedPaths(base: string, run: (args: string[]) => string | null): string[] | null;
