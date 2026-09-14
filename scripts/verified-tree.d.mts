// Type surface of scripts/verified-tree.mjs for tests/contracts/verified-tree.test.ts (tsconfig.qa.json).
export const VERIFIED_TREES_DIR: string;
export const MAX_MARKERS: number;
export type VerifiedTreeMarker = Readonly<{
  tree: string;
  commit: string;
  build: string;
  verifiedAt: string;
}>;
export function recordVerifiedTree(input: {
  stateDir: string;
  tree: string;
  commit: string;
  build: string;
  nowMs?: number;
}): string;
export function findVerifiedTree(stateDir: string, tree: string): VerifiedTreeMarker | null;
