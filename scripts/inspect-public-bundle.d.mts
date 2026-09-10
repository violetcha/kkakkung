// Type surface of scripts/inspect-public-bundle.mjs for tests/contracts/g4-bundle.test.ts.
export type Sentinel = Readonly<{ id: string; literal: string }>;
export type BundleFinding = Readonly<{ file: string; sentinel: string; line: number }>;
export const SCANNED_EXTENSIONS: readonly string[];
export function deriveSentinels(serverRoot?: string): Sentinel[];
export function listBundleFiles(directory: string): string[];
export function scanBundle(
  directory: string,
  sentinels: readonly Sentinel[],
): Readonly<{ files: string[]; findings: BundleFinding[] }>;
