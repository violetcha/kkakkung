import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

type RenameOptions = Readonly<{
  platform?: NodeJS.Platform;
  rename?: (source: string, target: string) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
}>;

const backoffs = [10, 20, 40] as const;
const transientWindowsCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Keep the same synced temporary file; never delete or copy over the prior checkpoint. */
export async function renameCheckpoint(
  source: string,
  target: string,
  options: RenameOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const rename = options.rename ?? fs.rename;
  const sleep = options.sleep ?? delay;
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code =
        error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
      const backoff = backoffs[attempt];
      if (
        platform !== 'win32' ||
        typeof code !== 'string' ||
        !transientWindowsCodes.has(code) ||
        backoff === undefined
      )
        throw error;
      await sleep(backoff);
    }
  }
}
