import { expect, test } from '@playwright/test';

// Real React component with a synthetic HTTP boundary. The SDK/host authorization and
// reservation races are covered separately by server/test/room/friend-invitations.test.ts.
test('host can create, copy, rotate and revoke a scoped invitation', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const requests: { method: string; authorization: string | undefined; body: string | null }[] = [];
  let count = 0;
  await page.route('**/api/sessions/current/invitation', async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      authorization: request.headers().authorization,
      body: request.postData(),
    });
    if (request.method() === 'DELETE') await route.fulfill({ status: 204 });
    else
      await route.fulfill({
        status: 201,
        json: {
          inviteToken: `synthetic-room-invitation-${++count}`,
          roomCode: 'ABCDEF',
          expiresAt: Date.now() + 60_000,
        },
      });
  });
  await page.goto('/test-fixtures/room-invitation.html');
  await page.getByRole('button', { name: '초대 링크 만들기', exact: true }).click();
  const link = page.getByLabel('친구에게 보낼 링크');
  await expect(link).toHaveValue(
    `${new URL(page.url()).origin}/#invite=synthetic-room-invitation-1&room=ABCDEF`,
  );
  await page.getByRole('button', { name: '초대 링크 복사', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
  await page.getByRole('button', { name: '초대 링크 재발급', exact: true }).click();
  await expect(link).toHaveValue(/invitation-2&room=ABCDEF$/);
  await page.getByRole('button', { name: '기존 초대 링크 회수', exact: true }).click();
  await expect(link).toHaveCount(0);
  await expect(page.getByText('기존 초대 링크를 회수했습니다.', { exact: true })).toBeVisible();
  await expect(page.getByText('팀원 로그인은 계속 필요합니다.', { exact: false })).toBeVisible();
  expect(requests).toEqual(
    ['POST', 'POST', 'DELETE'].map((method) => ({
      method,
      authorization: 'Bearer synthetic-component-session',
      body: null,
    })),
  );
  expect(await page.locator('body').innerText()).not.toContain('synthetic-component-session');
});

test('an unknown rotation result hides the previous link and permits explicit recovery', async ({
  page,
}) => {
  let count = 0;
  await page.route('**/api/sessions/current/invitation', (route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    if (++count === 1)
      return route.fulfill({
        status: 201,
        json: {
          inviteToken: 'synthetic-room-invitation',
          roomCode: 'ABCDEF',
          expiresAt: Date.now() + 60_000,
        },
      });
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto('/test-fixtures/room-invitation.html');
  await page.getByRole('button', { name: '초대 링크 만들기', exact: true }).click();
  await expect(page.getByLabel('친구에게 보낼 링크')).toBeVisible();
  await page.getByRole('button', { name: '초대 링크 재발급', exact: true }).click();
  await expect(page.getByLabel('친구에게 보낼 링크')).toHaveCount(0);
  await expect(page.getByText('처리 결과를 확인하지 못했습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '기존 초대 링크 회수', exact: true }).click();
  await expect(page.getByText('기존 초대 링크를 회수했습니다.', { exact: true })).toBeVisible();
});

test('expired invitations stop being shareable and denied clipboard has a selectable fallback', async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('DENIED')) },
    });
  });
  await page.route('**/api/sessions/current/invitation', (route) =>
    route.fulfill({
      status: 201,
      json: {
        inviteToken: 'synthetic-room-invitation',
        roomCode: 'ABCDEF',
        expiresAt: Date.now() + 2000,
      },
    }),
  );
  await page.goto('/test-fixtures/room-invitation.html');
  await page.getByRole('button', { name: '초대 링크 만들기', exact: true }).click();
  await page.getByRole('button', { name: '초대 링크 복사', exact: true }).click();
  await expect(page.getByText('자동 복사를 사용할 수 없습니다.', { exact: false })).toBeVisible();
  await page.getByLabel('친구에게 보낼 링크').focus();
  const selection = await page
    .getByLabel('친구에게 보낼 링크')
    .evaluate((input: HTMLInputElement) => ({
      selected: input.selectionEnd! - input.selectionStart!,
      length: input.value.length,
    }));
  expect(selection.length).toBeGreaterThan(0);
  expect(selection.selected).toBe(selection.length);
  await page.clock.fastForward(4000);
  await expect(page.getByText('초대 링크가 만료됐습니다. 새 링크를 만들어 주세요.')).toBeVisible();
  await expect(page.getByLabel('친구에게 보낼 링크')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '초대 링크 복사', exact: true })).toHaveCount(0);
});

test('closing the host screen cancels pending work and ignores its late result', async ({
  page,
}) => {
  let finish: (() => Promise<void>) | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/sessions/current/invitation', (route) => {
    finish = () =>
      route.fulfill({
        status: 201,
        json: {
          inviteToken: 'synthetic-late-invitation',
          roomCode: 'ABCDEF',
          expiresAt: Date.now() + 60_000,
        },
      });
  });
  await page.goto('/test-fixtures/room-invitation.html');
  await page.getByRole('button', { name: '초대 링크 만들기', exact: true }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await expect(
    page.getByRole('button', { name: '기존 초대 링크 회수', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '테스트 화면 닫기', exact: true }).click();
  await finish!();
  await expect(page.getByRole('region', { name: '친구 초대 관리', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
