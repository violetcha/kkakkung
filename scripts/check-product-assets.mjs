#!/usr/bin/env node
/* global Worker, createImageBitmap, document, getComputedStyle, OffscreenCanvas */
// Run after pnpm build. Exercises the shipped Worker and model bytes, not fake inference.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { verifyVisionAssetNotices } from './lib/vision-asset-notices.mjs';

const root = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.json': 'application/json',
};
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(resolve(root) + sep)) {
    res.writeHead(404).end();
    return;
  }
  void readFile(file)
    .then((bytes) => {
      res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      res.end(bytes);
    })
    .catch(() => res.writeHead(404).end());
});
let browser;
try {
  if (process.argv.slice(2).some((arg) => arg !== '--require-reviewed-rights'))
    throw new Error('INVALID_ASSET_CHECK_ARGUMENT');
  const notices = await verifyVisionAssetNotices(root, {
    requireReviewedRights: process.argv.includes('--require-reviewed-rights'),
  });
  const fontAssets = [
    ['Galmuri9.woff2', '275d995906625eaaa5d2d9baa0a80f90a5c033c381c0dc2108a8729d371041a6'],
    ['Galmuri11.woff2', 'f467d1b10e6b88dfa8399c9f93b38c7643e050abfe4fc15800ac0b000f5a57d6'],
    ['Galmuri11-Bold.woff2', '8643094f395aa2dbad6bc4385cc043314801eaec2e759d549435ec8ac4f2d078'],
    ['Galmuri14.woff2', '79b34b22b86536d0fe9ebe7105dd5f20f56558d691c67a0c6432807a03ec5a82'],
    ['OFL-1.1.txt', '86a3ee9495f942f0243f18c103da9faca27adb88142613edb8bb852e56c892c1'],
  ];
  for (const [name, expected] of fontAssets) {
    const bytes = await readFile(resolve(root, 'fonts', name));
    if (name.endsWith('.woff2') && bytes.subarray(0, 4).toString('ascii') !== 'wOF2')
      throw new Error('FONT_FILE_INVALID');
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('FONT_FILE_INVALID');
  }
  const workers = (await readdir(resolve(root, 'assets'))).filter((name) =>
    /^vision\.worker-.*\.js$/.test(name),
  );
  if (workers.length !== 1) throw new Error('BUILT_WORKER_MISSING');
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const fonts = await page.evaluate(async () => {
    const requested = [
      ['Galmuri9', '400 9px Galmuri9'],
      ['Galmuri11', '400 11px Galmuri11'],
      ['Galmuri11-Bold', '700 11px Galmuri11'],
      ['Galmuri14', '400 14px Galmuri14'],
    ];
    const loaded = {};
    for (const [name, descriptor] of requested) {
      const faces = await document.fonts.load(descriptor, '까꿍');
      loaded[name] = faces.length > 0 && document.fonts.check(descriptor, '까꿍');
    }
    const style = getComputedStyle(document.documentElement);
    return {
      loaded,
      body: style.getPropertyValue('--font-body').trim(),
      control: style.getPropertyValue('--font-control').trim(),
      small: style.getPropertyValue('--font-small').trim(),
    };
  });
  const normalizedFamily = (value) => value.replaceAll('"', '').replaceAll("'", '');
  if (Object.values(fonts.loaded).some((loaded) => !loaded)) throw new Error('FONT_LOAD_FAILED');
  // S15P21C204-294: product text uses the system gothic stack; the Galmuri faces stay bundled
  // (FONT_LOAD_FAILED above) for the logo and notices but are no longer part of the text tokens.
  const systemGothic = 'Segoe UI, Apple SD Gothic Neo, Malgun Gothic, sans-serif';
  if (
    normalizedFamily(fonts.body) !== systemGothic ||
    normalizedFamily(fonts.control) !== systemGothic ||
    normalizedFamily(fonts.small) !== systemGothic
  )
    throw new Error('FONT_FALLBACK_INVALID');
  const result = await page.evaluate(async (workerPath) => {
    const worker = new Worker(workerPath, { type: 'module' });
    try {
      const next = () =>
        new Promise((accept, reject) => {
          const timer = setTimeout(() => reject(new Error('WORKER_TIMEOUT')), 45000);
          worker.onerror = () => {
            clearTimeout(timer);
            reject(new Error('WORKER_FAILED'));
          };
          worker.onmessage = (event) => {
            clearTimeout(timer);
            accept(event.data);
          };
        });
      const ready = next();
      worker.postMessage({
        type: 'init',
        runtimeGeneration: 1,
        paths: {
          wasmBasePath: '/models/mediapipe/1.0.1/wasm',
          face: '/models/face/face_landmarker.task',
          pose: '/models/pose/pose_landmarker.task',
          gesture: '/models/gesture/gesture_recognizer.task',
        },
      });
      const loaded = await ready;
      if (loaded.type !== 'ready') throw new Error('WORKER_NOT_READY');
      const canvas = new OffscreenCanvas(256, 256);
      canvas.getContext('2d').fillRect(0, 0, 256, 256);
      const bitmap = await createImageBitmap(canvas);
      const frame = next();
      worker.postMessage(
        {
          type: 'frame',
          runtimeGeneration: 1,
          frameId: 1,
          sampledAtMs: 100,
          models: ['face', 'pose', 'gesture'],
          bitmap,
        },
        [bitmap],
      );
      const inferred = await frame;
      if (inferred.type !== 'result') throw new Error('INFERENCE_FAILED');
      return { models: loaded.loaded, outcomes: Object.keys(inferred.outcomes).sort() };
    } finally {
      worker.postMessage({ type: 'close' });
      worker.terminate();
    }
  }, '/assets/' + workers[0]);
  if (result.models.length !== 3 || result.outcomes.join(',') !== 'face,gesture,pose')
    throw new Error('INCOMPLETE_MODELS');
  console.log(
    JSON.stringify({
      status: 'PASS',
      builtWorker: true,
      realModels: result.models,
      syntheticBlankFrame: true,
      actualCamera: false,
      cloudExecuted: false,
      fontAssetsVerified: fontAssets.length,
      fontFacesLoaded: Object.keys(fonts.loaded),
      ...notices,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error && error.message === 'VISION_ASSET_RIGHTS_PENDING'
      ? error.message
      : error instanceof Error && error.message.startsWith('FONT_')
        ? error.message
        : 'BUILT_PRODUCT_ASSETS_FAILED',
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  if (server.listening) await new Promise((accept) => server.close(accept));
}
