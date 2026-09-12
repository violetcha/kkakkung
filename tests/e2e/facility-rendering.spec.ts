import { expect, test } from '@playwright/test';

test('product renderer survives direction, quality, visibility and scene lifecycle changes', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/preview');
  await page.getByRole('button', { name: '렌더 검수', exact: true }).click();
  const metrics = page.getByRole('status', { name: '렌더 측정' });
  const counts = async () => {
    const text = await metrics.textContent();
    const match = text?.match(/geometry (\d+) · texture (\d+)/);
    return match ? { geometry: Number(match[1]), texture: Number(match[2]) } : null;
  };
  await expect.poll(counts).not.toBeNull();
  await page.getByRole('button', { name: '출구·장비', exact: true }).click();
  await expect.poll(async () => (await counts())?.texture ?? 0).toBeGreaterThanOrEqual(4);
  const original = await counts();
  for (const facing of ['0', '1', '2', '3']) {
    await page.getByRole('combobox', { name: '바라보는 방향' }).selectOption(facing);
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  await page.screenshot({ path: info.outputPath('facility-exit.png'), fullPage: true });
  for (const scene of ['코너', '상대 5명', '복도', '상대 5명', '출구·장비']) {
    await page.getByRole('button', { name: scene, exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  await expect.poll(counts).toEqual(original);
  for (const quality of ['low', 'medium']) {
    await page.getByRole('combobox', { name: '화면 품질' }).selectOption(quality);
    await page.getByRole('button', { name: '렌더 해제', exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(metrics).toHaveText('측정 대기');
    await page.getByRole('button', { name: '렌더 다시 열기', exact: true }).click();
    // A fresh Canvas has not uploaded the earlier corridor's cached avatar geometry yet.
    // It may own fewer resources, but it must not accumulate more across re-entry.
    await expect
      .poll(async () => {
        const current = await counts();
        return (
          current !== null &&
          current.geometry > 0 &&
          current.geometry <= original!.geometry &&
          current.texture === original!.texture
        );
      })
      .toBe(true);
  }
  await page.getByRole('button', { name: '상대 5명', exact: true }).click();
  await page.screenshot({ path: info.outputPath('facility-crowd.png'), fullPage: true });
  expect(errors).toEqual([]);
});
