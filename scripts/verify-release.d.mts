// Type surface of scripts/verify-release.mjs for tests/contracts/deployment-sequence.test.ts.
import type { ReleaseManifest } from './lib/release-sequence.mjs';
export type ManifestInputs = Readonly<{
  sha: string;
  tag: string;
  verifiedSha: string;
  profile: 'product' | 'skeleton';
  officialBudgetMaxAgeMs?: number | null;
  nowEpochMs?: number;
}>;
export function inspectImageWithDocker(
  ref: string,
): Readonly<{ id: string; revision: string | null }> | null;
export function readPrevious(
  readState: (name: string) => string | null,
): ReleaseManifest['previous'];
export function buildManifest(
  inputs: ManifestInputs,
  inspect: (ref: string) => Readonly<{ id: string; revision: string | null }> | null,
  readState: (name: string) => string | null,
):
  | Readonly<{ manifest: ReleaseManifest & { createdAt: string }; error?: undefined }>
  | Readonly<{ error: 'IMAGE_MISSING' | 'MANIFEST_INVALID'; detail: string; manifest?: undefined }>;
