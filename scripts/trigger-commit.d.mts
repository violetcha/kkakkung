// Type surface of scripts/trigger-commit.mjs for tests/contracts/ci-contract.test.ts.
export function triggerVerdict(input: {
  head?: string;
  deploy?: boolean | string;
  mr?: string;
  push?: string;
}): { ok: true; sha: string; announced: string } | { ok: false; message: string };
