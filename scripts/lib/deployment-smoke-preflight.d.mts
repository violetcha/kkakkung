export function prepareDeploymentSmoke(input: {
  root: string;
  preflightPath: string | null;
  sourceCommit: string;
  env: Record<string, string | undefined>;
  nowEpochMs: number;
}): { evidenceDir: string };

export function deriveDeploymentPreflight(input: {
  root: string;
  preflightPath: string;
  sourceCommit: string;
  env: Record<string, string | undefined>;
  nowEpochMs: number;
}): import('../../tests/cloud/CloudPreflight').CloudPreflight;
