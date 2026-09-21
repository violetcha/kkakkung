// Type surface of scripts/secret-scan-range.mjs for tests/contracts/ci-contract.test.ts.
export function scanRange(
  bases: readonly string[],
  run?: (args: readonly string[]) => string | null,
): string | null;
