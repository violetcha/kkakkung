// Type surface of scripts/notify-build-failure.mjs for tests/contracts/notify-contract.test.ts (tsconfig.qa.json).
export type NotifyMap = Readonly<{ byEmail: Record<string, string>; mergeRequestBaseUrl: string }>;
export function loadMap(path?: string): NotifyMap;
export function resolveRecipient(
  map: NotifyMap,
  ...emails: Array<string | undefined>
): string | null;
export function buildPayload(
  env: Record<string, string | undefined>,
  map: NotifyMap,
): Readonly<{
  payload: { text: string; username: string; channel?: string };
  recipient: string | null;
}>;
