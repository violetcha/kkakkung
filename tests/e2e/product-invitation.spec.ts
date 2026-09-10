import { expect, test } from '@playwright/test';

test('a shared room invitation selects join and removes secrets before admission', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/play#invite=synthetic-invitation-123456&room=ABCDEF');
  await expect(page.getByLabel('방 코드')).toHaveValue('ABCDEF');
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByLabel('닉네임')).toBeVisible();
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  expect(errors).toEqual([]);
});

test('real local vision models initialize in the browser Worker', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/play');
  const result = await page.evaluate(async () => {
    const workerModule = '/src/features/vision/worker-scheduler.ts';
    const protocolModule = '/src/features/vision/worker-protocol.ts';
    const [{ createVisionWorker }, { PINNED_MODEL_PATHS }] = await Promise.all([
      import(workerModule),
      import(protocolModule),
    ]);
    const worker: Worker = createVisionWorker();
    try {
      return await new Promise<{ type: string; models?: string[] }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('VISION_INIT_TIMEOUT')), 45000);
        worker.onerror = () => {
          clearTimeout(timer);
          reject(new Error('VISION_WORKER_FAILED'));
        };
        worker.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        worker.postMessage({ type: 'init', runtimeGeneration: 1, paths: PINNED_MODEL_PATHS });
      });
    } finally {
      worker.postMessage({ type: 'close' });
      worker.terminate();
    }
  });
  expect(result).toMatchObject({ type: 'ready', loaded: ['face', 'pose', 'gesture'] });
});
