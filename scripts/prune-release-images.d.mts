// Type surface of scripts/prune-release-images.mjs for tests/contracts (tsconfig.qa.json).
export const DEFAULT_KEEP: number;
export const DEFAULT_MIN_AGE_MINUTES: number;
export type ImageTag = Readonly<{ tag: string; lastTagTimeMs: number }>;
export type KeptImage = ImageTag & Readonly<{ reason: 'recent' | 'protected' | 'young' }>;
export function parseDockerTime(text: string): number;
export function planPrune(input: {
  images: readonly ImageTag[];
  keep: number;
  minAgeMs: number;
  protect: readonly string[];
  nowMs: number;
}): { remove: ImageTag[]; kept: KeptImage[] };
export function parseArgs(argv: readonly string[]): {
  keep: number;
  minAgeMinutes: number;
  protect: string[];
  dryRun: boolean;
  repositories: string[];
};
export function main(
  argv: readonly string[],
  options?: { log?: (line: string) => void; nowMs?: number },
): number;
