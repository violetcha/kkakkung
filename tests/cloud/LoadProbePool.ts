// F-02 / QA-01. Node driver for the load probe page. Opens one browser context per participant,
// serves the page from a throwaway Vite server, and hands back the page's functions as a plain
// `LoadProbe`. Nothing here connects to Cloud by itself: grants arrive as arguments.
//
// The DP-06 pool (DeploymentBrowserPool) is fixed at six contexts because a smoke test is one
// room. A load stage is up to sixty, so the limit is a parameter here, and the caller states it
// rather than discovering it by failing halfway through a stage.
//
// Playwright errors never reach the caller: an evaluation argument can contain a grant, and the
// message of a failed evaluation can quote it. Every failure is one of `LoadProbeFailure`.
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import type { LoadProbe } from './LoadProbeTypes.ts';

const TIMEOUT_MS = 20_000;
const TEMP_PREFIX = 'qa11-load-probe-';
/** Six seats per room and ten rooms is the largest stage the capacity story allows. */
export const MAX_LOAD_PROBES = 60;

async function bounded<T>(work: Promise<T>, late?: (value: T) => Promise<unknown>): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = work.then(async (value) => {
    if (expired) {
      await late?.(value).catch(() => {});
      throw new Error('LOAD_PROBE_TIMEOUT');
    }
    return value;
  });
  try {
    return await Promise.race([
      guarded,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('LOAD_PROBE_TIMEOUT'));
        }, TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeEnvironment(directory: string) {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(TEMP_PREFIX))
    throw new Error('LOAD_PROBE_UNSAFE_TEMP_DIRECTORY');
  await rm(target, { recursive: true, force: true });
}

export type LoadProbePool = Readonly<{
  /** `faceLimit` is the stage's remote face ceiling: five in a match, two in practice. */
  create: (playerId: string, faceLimit?: number) => Promise<LoadProbe>;
  /** Contexts currently open, so a stage can assert it really reached its participant count. */
  size: () => number;
  close: () => Promise<void>;
}>;

export async function createLoadProbePool(limit = MAX_LOAD_PROBES): Promise<LoadProbePool> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LOAD_PROBES)
    throw new Error('LOAD_PROBE_LIMIT');
  let environmentDirectory: string | null = null;
  let vite: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let closing: Promise<void> | null = null;
  let opening = 0;
  const contexts = new Set<BrowserContext>();

  const closeContext = async (context: BrowserContext) => {
    await bounded(context.close());
    contexts.delete(context);
  };
  const close = () => {
    closing ??= (async () => {
      const failures: unknown[] = [];
      const results = await Promise.allSettled([...contexts].map(closeContext));
      failures.push(...results.filter((result) => result.status === 'rejected'));
      // Every resource is attempted even if an earlier close fails or times out.
      if (browser) await bounded(browser.close()).catch(() => failures.push(true));
      if (vite) await bounded(vite.close()).catch(() => failures.push(true));
      if (environmentDirectory)
        await bounded(removeEnvironment(environmentDirectory)).catch(() => failures.push(true));
      contexts.clear();
      if (failures.length) throw new Error('LOAD_PROBE_CLEANUP_FAILED');
    })();
    return closing;
  };

  try {
    environmentDirectory = await bounded(mkdtemp(join(tmpdir(), TEMP_PREFIX)), removeEnvironment);
    vite = await bounded(
      createServer({
        configFile: false,
        root: fileURLToPath(new URL('./', import.meta.url)),
        envDir: environmentDirectory,
        envPrefix: 'QA11_UNUSED_PUBLIC_',
        cacheDir: join(environmentDirectory, 'vite-cache'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0 },
      }),
      (server) => bounded(server.close()),
    );
    await bounded(vite.listen());
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('LOAD_PROBE_SERVER_UNAVAILABLE');
    browser = await bounded(
      chromium.launch({
        headless: true,
        timeout: TIMEOUT_MS,
        // A synthetic canvas and oscillator only; no device is opened and no prompt is answered.
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
      }),
      (value) => bounded(value.close()),
    );
    const activeBrowser = browser;
    const port = address.port;

    return {
      size: () => contexts.size,
      async create(playerId: string, faceLimit?: number): Promise<LoadProbe> {
        if (closing) throw new Error('LOAD_PROBE_POOL_CLOSED');
        if (contexts.size + opening >= limit) throw new Error('LOAD_PROBE_LIMIT');
        opening++;
        let context: BrowserContext | null = null;
        try {
          context = await bounded(
            activeBrowser.newContext({ serviceWorkers: 'block' }),
            closeContext,
          );
          contexts.add(context);
          if (closing) throw new Error('LOAD_PROBE_POOL_CLOSED');
          context.setDefaultTimeout(TIMEOUT_MS);
          context.setDefaultNavigationTimeout(TIMEOUT_MS);
          const page = await bounded(context.newPage());
          // No console, trace, screenshot, recording or network payload listeners are installed.
          await bounded(page.goto(`http://127.0.0.1:${port}/load-probe.html`));
          await bounded(
            page.waitForFunction(() => typeof window.initializeLoadProbe === 'function'),
          );
          await bounded(
            page.evaluate(([id, limit]) => window.initializeLoadProbe(id, limit), [
              playerId,
              faceLimit,
            ] as const),
          );
          if (closing) throw new Error('LOAD_PROBE_POOL_CLOSED');
          const ownedContext = context;
          const safe = async <T>(operation: () => Promise<T>): Promise<T> => {
            if (closing) throw new Error('LOAD_PROBE_POOL_CLOSED');
            try {
              return await bounded(operation());
            } catch (error) {
              if (error instanceof Error && error.message === 'LOAD_PROBE_TIMEOUT')
                await closeContext(ownedContext).catch(() => {});
              // eslint-disable-next-line preserve-caught-error -- Playwright causes may embed grant tokens.
              throw new Error('LOAD_PROBE_OPERATION_FAILED');
            }
          };
          return {
            connect: (grant) =>
              safe(() => page.evaluate((g) => window.kkakkungLoadProbe.connect(g), grant)),
            publish: () => safe(() => page.evaluate(() => window.kkakkungLoadProbe.publish())),
            applyBindings: (message) =>
              safe(() => page.evaluate((m) => window.kkakkungLoadProbe.applyBindings(m), message)),
            applyAudioPolicy: (message) =>
              safe(() =>
                page.evaluate((m) => window.kkakkungLoadProbe.applyAudioPolicy(m), message),
              ),
            poll: () => safe(() => page.evaluate(() => window.kkakkungLoadProbe.poll())),
            evidence: () => safe(() => page.evaluate(() => window.kkakkungLoadProbe.evidence())),
            cutoff: (sid) =>
              safe(() => page.evaluate((s) => window.kkakkungLoadProbe.cutoff(s), sid)),
            allowEffect: (sid, cutoff) =>
              safe(() =>
                page.evaluate(([s, c]) => window.kkakkungLoadProbe.allowEffect(s, c), [
                  sid,
                  cutoff,
                ] as const),
              ),
            denyEffect: (sid, cutoff, windowMs) =>
              safe(() =>
                page.evaluate(([s, c, w]) => window.kkakkungLoadProbe.denyEffect(s, c, w), [
                  sid,
                  cutoff,
                  windowMs,
                ] as const),
              ),
            now: () => safe(() => page.evaluate(() => window.kkakkungLoadProbe.now())),
            close: () => safe(() => page.evaluate(() => window.kkakkungLoadProbe.close())),
          };
        } catch {
          if (context) await closeContext(context).catch(() => {});
          throw new Error('LOAD_PROBE_INITIALIZATION_FAILED');
        } finally {
          opening--;
        }
      },
      close,
    };
  } catch {
    await close().catch(() => {});
    throw new Error('LOAD_PROBE_INITIALIZATION_FAILED');
  }
}
