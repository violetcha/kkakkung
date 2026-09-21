// Type surface of scripts/needs-image-build.mjs for tests/contracts/ci-contract.test.ts.
export const IMAGE_INPUT_FILES: readonly string[];
export const IMAGE_INPUT_DIRS: readonly string[];
export function touchesImageInputs(files: readonly string[]): boolean;
export function needsImageBuild(input: {
  deploy: boolean;
  changedFiles: readonly string[] | null;
}): boolean;
export function changedFilesAgainst(
  base: string,
  run?: (args: readonly string[]) => string | null,
): string[] | null;
