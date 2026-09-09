// Type surface of scripts/ci-verify.mjs for tests/contracts/ci-contract.test.ts (tsconfig.qa.json).
export type PlanStep = Readonly<{ id: string; description?: string; command?: readonly string[] }>;
export const PLAN: readonly PlanStep[];
export const REQUIRED: Readonly<{ node: string; pnpm: string }>;
export function chromiumPresent(browsersPath: string | undefined): boolean;
export function checkToolchain(nodeVersion: string, pnpmVersion: string | null): string[];
export function checkSourceSha(expected: string, head: string | null): string | null;
