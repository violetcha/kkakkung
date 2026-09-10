// F-02 / QA-01. Node-side driver for the probe page (tests/cloud/probe.html) under Playwright:
// builds the page with Vite, opens N browser contexts with synthetic devices, and exposes the
// page's exported functions. Tokens are handed to the page in memory and never logged or written.
// This module is exercised only from Cloud cases (run-cloud-check) — the default verify does not
// launch a browser through it. Until a Cloud run happens it is unverified against LiveKit.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

export type ProbeParticipant = Readonly<{
  page: Page;
  context: BrowserContext;
  connect: (url: string, token: string, publish: boolean) => Promise<void>;
  setSubscribed: (trackSid: string, subscribed: boolean) => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  snapshot: () => Promise<unknown>;
  /** Browser performance.now() sample for clock-offset estimation. */
  browserNow: () => Promise<number>;
}>;

export class ProbeHarness {
  private browser: Browser | null = null;
  private server: ViteDevServer | null = null;
  private readonly participants: ProbeParticipant[] = [];

  async start(): Promise<string> {
    this.server = await createServer({
      configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
      server: { port: 5175, strictPort: true },
      logLevel: 'silent',
    });
    await this.server.listen();
    this.browser = await chromium.launch({
      // Real GPU paths where available; software rendering is reported, never hidden.
      args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    });
    return `http://127.0.0.1:5175/probe.html`;
  }

  async participant(): Promise<ProbeParticipant> {
    if (!this.browser) throw new Error('PROBE_HARNESS_NOT_STARTED');
    const context = await this.browser.newContext({ permissions: [] });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5175/probe.html', { waitUntil: 'load' });
    // probe.ts publishes `window.kkakkungProbe = { connect, reconnect, setSubscribed, disconnect, snapshot }`.
    const call = <T>(fn: string, ...args: unknown[]) =>
      page.evaluate(
        ([name, values]) =>
          (
            window as unknown as {
              kkakkungProbe: Record<string, (...a: unknown[]) => T | Promise<T>>;
            }
          ).kkakkungProbe[name]!(...values),
        [fn, args] as const,
      );
    const participant: ProbeParticipant = {
      page,
      context,
      connect: (url, token, publish) => call<void>('connect', url, token, publish),
      setSubscribed: (sid, on) => call<void>('setSubscribed', sid, on),
      reconnect: () => call<void>('reconnect'),
      disconnect: () => call<void>('disconnect'),
      snapshot: () => call<unknown>('snapshot'),
      browserNow: () => page.evaluate(() => performance.timeOrigin + performance.now()),
    };
    this.participants.push(participant);
    return participant;
  }

  async stop(): Promise<void> {
    for (const p of this.participants.splice(0)) {
      try {
        await p.disconnect();
      } catch {
        /* the browser context is closed next regardless */
      }
      await p.context.close();
    }
    await this.browser?.close();
    this.browser = null;
    await this.server?.close();
    this.server = null;
  }
}
