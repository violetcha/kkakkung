import { test, expect } from '@playwright/test';

test('preserved team room connects two browsers, starts on ready and moves by its cell contract', async ({
  page,
  browser,
  request,
}) => {
  await expect
    .poll(async () => {
      try {
        return (await request.get('http://127.0.0.1:2567/health/ready')).status();
      } catch {
        return 0;
      }
    })
    .toBe(200);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('room-mode')).toHaveValue('team');
  await page.getByLabel('닉네임').fill('팀원 하나');
  await page.getByRole('button', { name: '입장', exact: true }).click();
  await expect(page.getByRole('button', { name: '시험장 나가기' })).toBeVisible();
  const context = await browser.newContext();
  const second = await context.newPage();
  try {
    await second.goto('http://127.0.0.1:5173/');
    await second.getByLabel('닉네임').fill('팀원 둘');
    await second.getByRole('button', { name: '입장', exact: true }).click();
    await expect(second.getByTestId('ready-button')).toBeVisible();
    await page.getByTestId('ready-button').click();
    await second.getByTestId('ready-button').click();
    await expect(page.getByTestId('team-phase')).toHaveAttribute('data-phase', 'playing');
    await page.bringToFront();
    await page.locator('canvas').click();
    const before = await page.getByTestId('own-position').innerText();
    await page.keyboard.press('w');
    await expect(page.getByTestId('own-position')).not.toHaveText(before);
    await page.screenshot({ path: 'test-results/team-room.png', fullPage: true });
    await page.getByRole('button', { name: '시험장 나가기' }).click();
    await expect(second.getByRole('complementary').getByRole('listitem')).toHaveCount(1);
    await second.getByRole('button', { name: '시험장 나가기' }).click();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
