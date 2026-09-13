export function archiveDeploymentSmoke(input: {
  sourceDir: string;
  evidenceDir: string;
  startedAt: number;
  code: number;
  now?: number;
}): { code: number; archive: string | null };
