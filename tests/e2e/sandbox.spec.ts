import { test, expect } from '@playwright/test';

const serverUrl = process.env.E2E_SERVER_URL ?? 'http://127.0.0.1:2567';

test('two browsers join, receive authoritative movement, and leave independently', async ({
  page,
  browser,
  request,
}) => {
  await expect
    .poll(async () => {
      try {
        return (await request.get(`${serverUrl}/health/ready`)).status();
      } catch {
        return 0;
      }
    })
    .toBe(200);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('room-mode').selectOption('sandbox');
  await expect(page.getByRole('heading', { name: '연동 시험장' })).toBeVisible();
  await page.getByLabel('닉네임').fill('하나');
  await page.getByRole('button', { name: '입장', exact: true }).click();
  await expect(page.getByRole('button', { name: '시험장 나가기' })).toBeVisible();
  await expect(page.getByText('1 / 6', { exact: true })).toBeVisible();

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await second.goto(new URL(page.url()).origin);
    await second.getByTestId('room-mode').selectOption('sandbox');
    await second.getByLabel('닉네임').fill('둘');
    await second.getByRole('button', { name: '입장', exact: true }).click();
    await expect(second.getByRole('button', { name: '시험장 나가기' })).toBeVisible();
    await expect(page.getByText('2 / 6', { exact: true })).toBeVisible();
    await page.bringToFront();
    await page.locator('canvas').click();
    const position = page.getByTestId('own-position');
    const before = await position.innerText();
    await page.keyboard.down('d');
    try {
      await expect(position).not.toHaveText(before);
    } finally {
      await page.keyboard.up('d');
    }
    await page.screenshot({ path: 'test-results/sandbox.png', fullPage: true });
    await page.getByRole('button', { name: '시험장 나가기' }).click();
    await expect(page.getByRole('button', { name: '입장', exact: true })).toBeVisible();
    await expect(second.getByText('1 / 6', { exact: true })).toBeVisible();
    await expect(second.getByRole('button', { name: '시험장 나가기' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await secondContext.close();
  }
});
