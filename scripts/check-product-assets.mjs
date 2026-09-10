#!/usr/bin/env node
/* global Worker, createImageBitmap, OffscreenCanvas */
// Run after pnpm build. Exercises the shipped Worker and model bytes, not fake inference.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

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
    }),
  );
} catch {
  console.error('BUILT_PRODUCT_ASSETS_FAILED');
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.closeAllConnections();
  if (server.listening) await new Promise((accept) => server.close(accept));
}
