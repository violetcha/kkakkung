import { expect, test, type Page, type TestInfo } from '@playwright/test';

// CI renders with SwiftShader (software WebGL) on a 4 vCPU burstable host. Every wait below that
// depends on 렌더 측정 needs ten rendered frames, so one slow host multiplies through the whole
// spec: kkakkung-mr #171 spent the entire 60 s budget and never reached the crowd screenshot,
// while the same steps take 12 s locally under forced SwiftShader. The budget is sized for that
// host and the crowd screenshot has its own test so one slow lifecycle run cannot starve it.
test.setTimeout(120_000);

const stepTimings = new Map<string, number>();
let stepStart = 0;
const mark = (label: string) => {
  const now = Date.now();
  stepTimings.set(label, now - stepStart);
  stepStart = now;
};
test.beforeEach(() => {
  stepTimings.clear();
  stepStart = Date.now();
});
// Playwright requires the destructured fixtures parameter even when none is used.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return;
  // Shows on failure next to the screenshot so a slow host is distinguishable from a hung renderer.
  await info.attach('step-timings-ms', {
    body: JSON.stringify(Object.fromEntries(stepTimings)),
    contentType: 'application/json',
  });
});

async function openRenderReview(page: Page) {
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
  mark('first-frame');
  // 렌더 측정 reports once a second, so a reading right after a scene change is usually the
  // previous scene's report. The baseline is taken only from a report produced after the change
  // and confirmed by the next report carrying the same resource counts, whichever theme draws
  // (S15P21C204-268: the block theme already has five textures in the corridor scene, so a
  // "texture ≥ 4" wait alone no longer proves the exit scene has arrived).
  const settledAfter = async (before: string | null) => {
    await expect
      .poll(async () => (await metrics.textContent()) !== before, { timeout: 15_000 })
      .toBe(true);
    let text = await metrics.textContent();
    let previous = await counts();
    await expect
      .poll(
        async () => {
          const now = await metrics.textContent();
          if (now === text) return false;
          const current = await counts();
          const same =
            previous !== null &&
            current !== null &&
            current.geometry === previous.geometry &&
            current.texture === previous.texture;
          text = now;
          previous = current;
          return same;
        },
        { timeout: 15_000, intervals: [250] },
      )
      .toBe(true);
    return counts();
  };
  return { errors, metrics, counts, settledAfter };
}

async function fullPageShot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  mark(`screenshot-${name}`);
}

test('product renderer survives direction, quality, visibility and scene lifecycle changes', async ({
  page,
}, info) => {
  const { errors, metrics, counts, settledAfter } = await openRenderReview(page);
  const beforeExit = await metrics.textContent();
  await page.getByRole('button', { name: '출구·장비', exact: true }).click();
  await expect.poll(async () => (await counts())?.texture ?? 0).toBeGreaterThanOrEqual(4);
  const original = await settledAfter(beforeExit);
  mark('exit-scene');
  for (const facing of ['0', '1', '2', '3']) {
    await page.getByRole('combobox', { name: '바라보는 방향' }).selectOption(facing);
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  mark('facings');
  await fullPageShot(page, info, 'facility-exit');
  for (const scene of ['코너', '상대 5명', '복도', '상대 5명', '출구·장비']) {
    await page.getByRole('button', { name: scene, exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  await expect.poll(counts).toEqual(original);
  mark('scene-cycle');
  for (const quality of ['low', 'medium']) {
    await page.getByRole('combobox', { name: '화면 품질' }).selectOption(quality);
    const expectedTextures = quality === 'low' ? original!.texture - 2 : original!.texture;
    await expect
      .poll(async () => (await counts())?.texture ?? -1, { timeout: 15_000 })
      .toBe(expectedTextures);
    const qualityResources = await counts();
    await page.getByRole('button', { name: '렌더 해제', exact: true }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(metrics).toHaveText('측정 대기');
    await page.getByRole('button', { name: '렌더 다시 열기', exact: true }).click();
    // A fresh Canvas has not uploaded the earlier corridor's cached avatar geometry yet.
    // It may own fewer resources, but it must not accumulate more across re-entry. Texture counts
    // are compared with the selected quality because low intentionally drops roughness/normal maps.
    await expect
      .poll(async () => {
        const current = await counts();
        return (
          current !== null &&
          current.geometry > 0 &&
          current.geometry <= qualityResources!.geometry &&
          current.texture === expectedTextures
        );
      })
      .toBe(true);
    mark(`reopen-${quality}`);
  }
  expect(errors).toEqual([]);
});

test('product renderer draws the five-opponent crowd scene', async ({ page }, info) => {
  const { errors, metrics, counts } = await openRenderReview(page);
  const before = await metrics.textContent();
  await page.getByRole('button', { name: '상대 5명', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(1);
  // Wait for a metrics report produced after the scene change so the screenshot shows the crowd
  // rather than the previous scene's last frame (kkakkung-mr #171's first attempt).
  await expect.poll(async () => (await metrics.textContent()) !== before).toBe(true);
  await expect.poll(async () => (await counts())?.geometry ?? 0).toBeGreaterThan(0);
  mark('crowd-frame');
  await fullPageShot(page, info, 'facility-crowd');
  expect(errors).toEqual([]);
});
