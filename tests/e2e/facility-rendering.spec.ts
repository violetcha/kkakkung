import { expect, test, type Page, type TestInfo } from '@playwright/test';

// CI renders with SwiftShader (software WebGL) on a 4 vCPU burstable host. Keep direction/scene
// checks separate from the two quality-specific remount checks: at less than one frame per second,
// combining them can exhaust one test's budget even though every individual transition succeeds.
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
  const failedResponses: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400)
      failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  await page.goto('/preview');
  await page.getByRole('button', { name: '렌더 검수', exact: true }).click();
  const metrics = page.getByRole('status', { name: '렌더 측정' });
  const counts = async () => {
    const text = await metrics.textContent();
    const match = text?.match(
      /draw (\d+) · triangles (\d+) · geometry (\d+) · texture (\d+) · program (\d+)/,
    );
    return match
      ? {
          draws: Number(match[1]),
          triangles: Number(match[2]),
          geometry: Number(match[3]),
          texture: Number(match[4]),
          programs: Number(match[5]),
        }
      : null;
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
  return { errors, failedResponses, metrics, counts, settledAfter };
}

async function fullPageShot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  mark(`screenshot-${name}`);
}

test('product renderer survives direction and visibility changes', async ({ page }, info) => {
  const { errors, failedResponses, metrics, counts, settledAfter } = await openRenderReview(page);
  const beforeExit = await metrics.textContent();
  await page.getByRole('button', { name: '출구·장비', exact: true }).click();
  await expect.poll(async () => (await counts())?.texture ?? 0).toBeGreaterThanOrEqual(4);
  const exitCounts = await settledAfter(beforeExit);
  expect(exitCounts).not.toBeNull();
  mark('exit-scene');
  for (const facing of ['0', '1', '2', '3']) {
    await page.getByRole('combobox', { name: '바라보는 방향' }).selectOption(facing);
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  mark('facings');
  await fullPageShot(page, info, 'facility-exit');

  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test('product renderer keeps resource counts stable across scene cycles', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const { errors, failedResponses, metrics, settledAfter } = await openRenderReview(page);
  const cycleScenes = ['코너', '상대 5명', '복도', '출구·장비'] as const;
  const cycleScenesOnce = async () => {
    for (const scene of cycleScenes) {
      await page.getByRole('button', { name: scene, exact: true }).click();
      await expect(page.locator('canvas')).toHaveCount(1);
    }
  };
  const beforeWarmCycle = await metrics.textContent();
  await cycleScenesOnce();
  const warmedExit = await settledAfter(beforeWarmCycle);
  expect(warmedExit).not.toBeNull();
  const beforeMeasuredCycle = await metrics.textContent();
  await cycleScenesOnce();
  const recycledExit = await settledAfter(beforeMeasuredCycle);
  expect(recycledExit).toEqual(warmedExit);
  mark('scene-cycle');

  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test('product renderer releases textures across medium and low quality remounts', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const { errors, failedResponses, metrics, settledAfter } = await openRenderReview(page);
  const loading = page.getByRole('status', { name: '아바타 로딩' });

  const beforeWarm = await metrics.textContent();
  await page.getByRole('button', { name: '상대 5명', exact: true }).click();
  await expect(loading).toHaveText('준비 5/5 · 대체 0');
  const mediumCrowd = await settledAfter(beforeWarm);
  expect(mediumCrowd).not.toBeNull();
  mark('role-geometries-warmed');

  await page.getByRole('button', { name: '렌더 해제', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(metrics).toHaveText('측정 대기');
  const beforeMediumReopen = await metrics.textContent();
  await page.getByRole('button', { name: '렌더 다시 열기', exact: true }).click();
  await expect(loading).toHaveText('준비 5/5 · 대체 0');
  const reopenedMedium = await settledAfter(beforeMediumReopen);
  expect(reopenedMedium).not.toBeNull();
  expect(reopenedMedium!.texture, 'medium stable texture').toBeLessThanOrEqual(
    mediumCrowd!.texture,
  );
  mark('reopen-medium');

  const beforeLow = await metrics.textContent();
  await page.getByRole('combobox', { name: '화면 품질' }).selectOption('low');
  await expect(loading).toHaveText('준비 5/5 · 대체 0');
  const lowCrowd = await settledAfter(beforeLow);
  expect(lowCrowd).not.toBeNull();
  await page.getByRole('button', { name: '렌더 해제', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(metrics).toHaveText('측정 대기');
  const beforeLowReopen = await metrics.textContent();
  await page.getByRole('button', { name: '렌더 다시 열기', exact: true }).click();
  await expect(loading).toHaveText('준비 5/5 · 대체 0');
  const reopenedLow = await settledAfter(beforeLowReopen);
  expect(reopenedLow).not.toBeNull();
  expect(reopenedLow!.texture, 'low stable texture').toBeLessThanOrEqual(lowCrowd!.texture);
  mark('reopen-low');
  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test('product renderer draws the five-opponent crowd scene', async ({ page }, info) => {
  const { errors, failedResponses, metrics, counts } = await openRenderReview(page);
  const before = await metrics.textContent();
  await page.getByRole('button', { name: '상대 5명', exact: true }).click();
  await expect(page.locator('canvas')).toHaveCount(1);
  // Wait for a metrics report produced after the scene change so the screenshot shows the crowd
  // rather than the previous scene's last frame (kkakkung-mr #171's first attempt).
  await expect.poll(async () => (await metrics.textContent()) !== before).toBe(true);
  await expect.poll(async () => (await counts())?.geometry ?? 0).toBeGreaterThan(0);
  mark('crowd-frame');
  await fullPageShot(page, info, 'facility-crowd');
  const beforeSide = await metrics.textContent();
  await page.getByRole('combobox', { name: '상대 방향' }).selectOption('side');
  await expect.poll(async () => (await metrics.textContent()) !== beforeSide).toBe(true);
  await fullPageShot(page, info, 'facility-crowd-side');
  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test('product renderer loads and captures both role avatars', async ({ page }, info) => {
  const { errors, failedResponses, metrics, counts, settledAfter } = await openRenderReview(page);
  const loading = page.getByRole('status', { name: '아바타 로딩' });
  const baseline = await counts();
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/models/avatars/v1/manifest.json');
    return response.json() as Promise<{ roles: { tagger: { metrics: { triangles: number } } } }>;
  });

  const beforeRunner = await metrics.textContent();
  await page.getByRole('button', { name: '도망자 단독', exact: true }).click();
  await expect(loading).toHaveText('준비 1/1 · 대체 0');
  const runner = await settledAfter(beforeRunner);
  expect(runner!.texture).toBeGreaterThan(baseline!.texture);
  await fullPageShot(page, info, 'avatar-runner-front');

  const beforeTagger = await metrics.textContent();
  await page.getByRole('button', { name: '술래 단독', exact: true }).click();
  await expect(loading).toHaveText('준비 1/1 · 대체 0');
  const tagger = await settledAfter(beforeTagger);
  expect(tagger!.triangles).toBeGreaterThanOrEqual(manifest.roles.tagger.metrics.triangles);
  await fullPageShot(page, info, 'avatar-tagger-front');

  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
