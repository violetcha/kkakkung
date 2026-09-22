// Type surface of scripts/trigger-commit.mjs for tests/contracts/ci-contract.test.ts.
export function triggerVerdict(
  input: { head?: string; mr?: string; push?: string },
  isAncestor?: (ancestor: string, descendant: string) => boolean,
):
  | { ok: true; sha: string; advancedFrom?: string; announced: boolean }
  | { ok: false; message: string };
