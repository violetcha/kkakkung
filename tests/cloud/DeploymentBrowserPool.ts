import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import type { DeploymentMediaProbe } from './DeploymentInteraction.js';

const TIMEOUT_MS = 15_000;
const TEMP_PREFIX = 'dp06-probe-env-';

async function bounded<T>(work: Promise<T>, late?: (value: T) => Promise<unknown>): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = work.then(async (value) => {
    if (expired) {
      await late?.(value).catch(() => {});
      throw new Error('DP06_BROWSER_TIMEOUT');
    }
    return value;
  });
  try {
    return await Promise.race([
      guarded,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('DP06_BROWSER_TIMEOUT'));
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
    throw new Error('DP06_UNSAFE_TEMP_DIRECTORY');
  await rm(target, { recursive: true, force: true });
}

/** Test-owned local pages only; Cloud credentials enter through in-memory grant arguments. */
export async function createDeploymentBrowserPool() {
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
      if (browser)
        await bounded(browser.close()).catch(() => {
          failures.push(true);
        });
      if (vite)
        await bounded(vite.close()).catch(() => {
          failures.push(true);
        });
      if (environmentDirectory)
        await bounded(removeEnvironment(environmentDirectory)).catch(() => {
          failures.push(true);
        });
      contexts.clear();
      if (failures.length) throw new Error('DP06_BROWSER_CLEANUP_FAILED');
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
        envPrefix: 'DP06_UNUSED_PUBLIC_',
        cacheDir: join(environmentDirectory, 'vite-cache'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0 },
      }),
      (server) => bounded(server.close()),
    );
    await bounded(vite.listen());
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('DP06_PROBE_SERVER_UNAVAILABLE');
    browser = await bounded(
      chromium.launch({
        headless: true,
        timeout: TIMEOUT_MS,
        args: ['--autoplay-policy=no-user-gesture-required'],
      }),
      (value) => bounded(value.close()),
    );
    const activeBrowser = browser;
    return {
      async create(playerId: string): Promise<DeploymentMediaProbe> {
        if (closing) throw new Error('DP06_BROWSER_POOL_CLOSED');
        if (contexts.size + opening >= 6) throw new Error('DP06_BROWSER_LIMIT');
        opening++;
        let context: BrowserContext | null = null;
        try {
          context = await bounded(
            activeBrowser.newContext({ serviceWorkers: 'block' }),
            closeContext,
          );
          contexts.add(context);
          if (closing) throw new Error('DP06_BROWSER_POOL_CLOSED');
          context.setDefaultTimeout(TIMEOUT_MS);
          context.setDefaultNavigationTimeout(TIMEOUT_MS);
          const page = await bounded(context.newPage());
          // No console, trace, screenshot, recording or network payload listeners are installed.
          await bounded(page.goto('http://127.0.0.1:' + address.port + '/deployment-probe.html'));
          await bounded(
            page.waitForFunction(() => typeof window.initializeDeploymentProbe === 'function'),
          );
          await bounded(page.evaluate((id) => window.initializeDeploymentProbe(id), playerId));
          if (closing) throw new Error('DP06_BROWSER_POOL_CLOSED');
          const ownedContext = context;
          const safe = async <T>(operation: () => Promise<T>): Promise<T> => {
            if (closing) throw new Error('DP06_BROWSER_POOL_CLOSED');
            try {
              return await bounded(operation());
            } catch (error) {
              if (error instanceof Error && error.message === 'DP06_BROWSER_TIMEOUT')
                await closeContext(ownedContext).catch(() => {});
              // Do not forward Playwright errors: evaluation arguments can contain grants.
              // eslint-disable-next-line preserve-caught-error -- Playwright causes may embed grant tokens.
              throw new Error('DP06_BROWSER_OPERATION_FAILED');
            }
          };
          return {
            connect: (grant) =>
              safe(() => page.evaluate((g) => window.deploymentProbe.connect(g), grant)),
            publish: () => safe(() => page.evaluate(() => window.deploymentProbe.publish())),
            applyBindings: (message) =>
              safe(() => page.evaluate((m) => window.deploymentProbe.applyBindings(m), message)),
            applyAudioPolicy: (message) =>
              safe(() => page.evaluate((m) => window.deploymentProbe.applyAudioPolicy(m), message)),
            snapshot: () => safe(() => page.evaluate(() => window.deploymentProbe.snapshot())),
            close: () => safe(() => page.evaluate(() => window.deploymentProbe.close())),
          };
        } catch {
          if (context) await closeContext(context).catch(() => {});
          throw new Error('DP06_BROWSER_INITIALIZATION_FAILED');
        } finally {
          opening--;
        }
      },
      close,
    };
  } catch {
    await close().catch(() => {});
    throw new Error('DP06_BROWSER_INITIALIZATION_FAILED');
  }
}
