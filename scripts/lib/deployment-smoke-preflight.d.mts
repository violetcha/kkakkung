export function prepareDeploymentSmoke(input: {
  root: string;
  preflightPath: string | null;
  sourceCommit: string;
  env: Record<string, string | undefined>;
  nowEpochMs: number;
}): { evidenceDir: string };
