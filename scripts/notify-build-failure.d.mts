// Type surface of scripts/notify-build-failure.mjs for tests/contracts/notify-contract.test.ts (tsconfig.qa.json).
export type NotifyMap = Readonly<{
  byEmail: Record<string, string>;
  byGitlabUsername: Record<string, string>;
  mergeRequestBaseUrl: string;
}>;
export type RecipientKey = string | Readonly<{ email?: string; username?: string }>;
export type ExcerptLimits = Readonly<{ maxLines: number; maxChars: number }>;
export const EXCERPT_LIMITS: ExcerptLimits;
export function loadMap(path?: string): NotifyMap;
export function resolveRecipient(
  map: NotifyMap,
  ...keys: Array<RecipientKey | undefined>
): string | null;
/** Cuts webhook URLs, bearer tokens and `token=`-style values out of one log line. */
export function redact(line: string): string;
/** Failure-first excerpt of a console log; null for an empty log. */
export function excerptLog(text: string | null | undefined, limits?: ExcerptLimits): string | null;
/** Vitest "FAIL path > suite > case" entries, deduplicated. */
export function failedTests(text: string | null | undefined): string[];
/** Reads $JENKINS_HOME/jobs/<job>/builds/<n>/log (or BUILD_LOG_FILE); null when unavailable. */
export function readBuildLog(env: Record<string, string | undefined>): string | null;
export function buildPayload(
  env: Record<string, string | undefined>,
  map: NotifyMap,
  log?: string | null,
): Readonly<{
  payload: { text: string; username: string; channel?: string };
  recipient: string | null;
}>;
