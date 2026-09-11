export function buildReleaseImages(
  sha: string,
  inspect: (ref: string) => { id: string; revision: string | null } | null,
  build: (file: string, ref: string, sha: string) => number | null,
): void;
