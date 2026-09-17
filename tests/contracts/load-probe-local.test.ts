// F-02 / QA-01. Local browser checks for the load probe. Never call connect, publish, session or
// any Cloud endpoint here: a PASS is evidence about the instrument, not about LiveKit.
//
// The self test is the one that matters. It puts the publisher and the reader on the two ends of
// the same local MediaStreamTracks, so it proves the marker survives canvas capture, a video
// element, a pixel read, the audio graph and an FFT. Whether the marker survives a real encoder
// and the SFU stays unverified until a Cloud stage runs.
import { afterAll, expect, it } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { createLoadProbePool, MAX_LOAD_PROBES } from '../cloud/LoadProbePool.ts';
import type { MarkerSelfTestResult } from '../cloud/marker-selftest.ts';

let browser: Browser | null = null;
let vite: ViteDevServer | null = null;

afterAll(async () => {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
});

it('loads the isolated load probe and closes an empty page without Cloud IO', async () => {
  const pool = await createLoadProbePool(2);
  try {
    const probe = await pool.create('local-empty-load-probe', 2);
    expect(pool.size()).toBe(1);
    const empty = await probe.poll();
    expect(empty.connected).toBe(false);
    expect(empty.remote).toEqual([]);
    expect(empty.publishedTracks).toEqual([]);
    expect(empty.outgoing).toEqual({ frameSerial: 0, toneSequence: 0 });
    expect(empty.atMs).toBeGreaterThan(0);

    // A cutoff without a marker still pins a time, with a serial nothing can fall below.
    const cutoff = await probe.cutoff('no-such-sid');
    expect(cutoff?.serial).toBe(-1);
    expect(await probe.allowEffect('no-such-sid', cutoff!)).toBeNull();
    expect(await probe.denyEffect('no-such-sid', cutoff!, 1000)).toEqual({
      silent: false,
      newMarkers: 0,
      bytesAfterCutoff: null,
    });

    // REQ-D-13: the page answers in the product's own MediaEvidence shape, built by the web app's
    // composeMediaEvidence, so a Cloud runner reads what D defined rather than a probe summary.
    const evidence = await probe.evidence();
    expect(evidence.scope).toBeNull();
    expect(evidence.generationState).toBe('closed');
    expect(evidence.published).toEqual([]);
    expect(evidence.received).toEqual([]);
    expect(evidence.integrity).toEqual({
      forbiddenButSubscribed: [],
      mutedButSubscribed: [],
      authorizedButUnsubscribed: [],
    });
    expect(evidence.remoteFaceLimit).toBe(2);
    expect(evidence.attachedFaceCount).toBe(0);

    await Promise.all([probe.close(), probe.close()]);
    expect((await probe.poll()).connected).toBe(false);
    await Promise.all([pool.close(), pool.close()]);
    await expect(pool.create('after-close')).rejects.toThrow('LOAD_PROBE_POOL_CLOSED');
  } finally {
    await pool.close().catch(() => {});
  }
}, 60_000);

it('refuses a participant count outside the ten-room ceiling and beyond its own limit', async () => {
  await expect(createLoadProbePool(0)).rejects.toThrow('LOAD_PROBE_LIMIT');
  await expect(createLoadProbePool(MAX_LOAD_PROBES + 1)).rejects.toThrow('LOAD_PROBE_LIMIT');
  const pool = await createLoadProbePool(1);
  try {
    await pool.create('first');
    await expect(pool.create('second')).rejects.toThrow('LOAD_PROBE_LIMIT');
  } finally {
    await pool.close().catch(() => {});
  }
}, 60_000);

it('decodes the published face and tone markers back out of real local tracks', async () => {
  vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../cloud/', import.meta.url)),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('SELFTEST_SERVER_UNAVAILABLE');
  browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/marker-selftest.html`);
  await page.waitForFunction(() => typeof window.runMarkerSelfTest === 'function');
  const result = (await page.evaluate(() =>
    window.runMarkerSelfTest(3000, 100),
  )) as MarkerSelfTestResult;

  // The publisher must actually have advanced, or the run proves nothing. A headless background
  // page throttles its timers, so the bounds stay well under the nominal 10 fps and 4 steps/s.
  expect(result.published.frames).toBeGreaterThan(10);
  expect(result.published.toneSteps).toBeGreaterThan(4);

  expect(result.face.reader).toBe('opened');
  expect(result.face.samples).toBeGreaterThan(5);
  expect(result.face.monotone).toBe(true);
  // The reader anchors on its first reading, so only the advance is comparable, not the value.
  // It can never exceed what the publisher drew: that would mean the decoder invented frames.
  expect(result.face.advance).toBeGreaterThan(0);
  expect(result.face.advance!).toBeLessThanOrEqual(result.published.frames);

  expect(result.tone.reader).toBe('opened');
  expect(result.tone.samples).toBeGreaterThan(3);
  expect(result.tone.monotone).toBe(true);
  expect(result.tone.advance).toBeGreaterThan(0);
  expect(result.tone.advance!).toBeLessThanOrEqual(result.published.toneSteps);
}, 90_000);
