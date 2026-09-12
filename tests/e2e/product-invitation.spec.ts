import { expect, test } from '@playwright/test';

test('same-tab invitations refresh a rejected form and its next request', async ({ page }) => {
  const attempts: unknown[] = [];
  await page.route('**/api/sessions', async (route) => {
    attempts.push(route.request().postDataJSON());
    await route.fulfill({ status: 403, json: { error: 'INVALID_INVITATION' } });
  });
  await page.goto('/play');
  await expect(page.getByRole('button', { name: '방 만들기', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    location.hash = 'invite=synthetic-create-invitation';
  });
  await page.getByLabel('닉네임').fill('test');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await expect(page.getByText('유효한 초대 링크가 필요합니다.')).toBeVisible();
  await page.evaluate(() => {
    location.hash = 'invite=synthetic-new-invitation&room=ABCDEF';
  });
  await expect(page.getByLabel('방 코드')).toHaveValue('ABCDEF');
  await expect(page.getByText('유효한 초대 링크가 필요합니다.')).toHaveCount(0);
  await expect(page).toHaveURL(/\/play$/);
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts).toEqual([
    { nickname: 'test', inviteToken: 'synthetic-create-invitation', createRoom: true },
    {
      nickname: 'test',
      inviteToken: 'synthetic-new-invitation',
      createRoom: false,
      roomCode: 'ABCDEF',
    },
  ]);
});

test('a late canceled admission and failed SDK join return their own reservations', async ({
  page,
}) => {
  const canceled: string[] = [];
  let finishFirst!: () => Promise<void>;
  let attempts = 0;
  await page.route('**/api/sessions/current', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    canceled.push(route.request().headers().authorization!);
    await route.fulfill({ status: 204 });
  });
  await page.route('**/matchmake/**', (route) => route.abort());
  await page.route('**/api/sessions', async (route) => {
    const index = ++attempts;
    const finish = () =>
      route.fulfill({
        status: 201,
        json: {
          sessionToken: `synthetic-session-${index}`,
          playerId: `player-${index}`,
          roomCode: 'ABCDEF',
          expiresAt: 1900000000000,
          protocolVersion: '0.2.0',
        },
      });
    if (index === 1) finishFirst = finish;
    else await finish();
  });
  await page.goto('/play#invite=synthetic-create-invitation');
  await page.getByLabel('닉네임').fill('test');
  await page.getByRole('button', { name: '방 만들기', exact: true }).click();
  await expect.poll(() => attempts).toBe(1);
  await page.evaluate(() => {
    location.hash = 'invite=synthetic-new-invitation&room=ABCDEF';
  });
  await expect(page.getByLabel('방 코드')).toBeEnabled();
  await finishFirst();
  await expect.poll(() => canceled).toEqual(['Bearer synthetic-session-1']);
  await expect(page.getByRole('button', { name: '방 참가', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  await expect
    .poll(() => canceled)
    .toEqual(['Bearer synthetic-session-1', 'Bearer synthetic-session-2']);
  await expect(
    page.getByText('연결할 수 없습니다. 로그인과 네트워크 상태를 확인해 주세요.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '방 참가', exact: true })).toBeEnabled();
});

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
