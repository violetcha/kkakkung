import { expect, test, type Page } from '@playwright/test';

// S15P21C204-276. 경기 화면 풀스크린 오버레이 배치. /preview 의 합성 fixture 만 쓴다.
async function openHud(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/preview');
  await page.getByRole('button', { name: '경기 HUD', exact: true }).click();
  await expect(page.locator('.game-stage')).toBeVisible();
  return errors;
}

/** 화면 위 사각형. 오버레이가 무대 안에 있는지, 서로 겹치는지 보는 데 쓴다. */
const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`${selector} 없음`);
  return rect;
};

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the six game overlays sit in their own place over a full-bleed 3D stage', async ({
  page,
}) => {
  const errors = await openHud(page);

  // 3D 는 무대 전체를 채운다.
  const stage = await box(page, '.game-stage');
  const canvas = await box(page, '.game-stage > .product-canvas');
  expect(Math.abs(canvas.width - stage.width)).toBeLessThan(6);
  expect(Math.abs(canvas.height - stage.height)).toBeLessThan(6);

  // 여섯 오버레이가 모두 무대 안에 있다.
  const parts = {
    hud: await box(page, '.game-stage > .game-hud'),
    hotbar: await box(page, '.game-stage > .hotbar'),
    log: await box(page, '.game-stage > .event-log'),
    crosshair: await box(page, '.game-stage > .crosshair'),
    minimap: await box(page, '.game-stage > .mini-map'),
    drawer: await box(page, '.game-stage > .hud-drawer'),
  };
  for (const [name, rect] of Object.entries(parts)) {
    expect(rect.x, name).toBeGreaterThanOrEqual(stage.x - 1);
    expect(rect.y, name).toBeGreaterThanOrEqual(stage.y - 1);
    expect(rect.x + rect.width, name).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(rect.y + rect.height, name).toBeLessThanOrEqual(stage.y + stage.height + 1);
  }

  // 상태 줄은 위, 핫바는 아래 가운데, 로그는 좌하단, 미니맵은 우하단이다.
  expect(parts.hud.y).toBeLessThan(stage.y + stage.height / 2);
  expect(parts.hotbar.y).toBeGreaterThan(stage.y + stage.height / 2);
  expect(parts.log.x).toBeLessThan(stage.x + stage.width / 2);
  expect(parts.log.y).toBeGreaterThan(stage.y + stage.height / 2);
  expect(parts.minimap.x).toBeGreaterThan(stage.x + stage.width / 2);
  expect(parts.minimap.y).toBeGreaterThan(stage.y + stage.height / 2);

  // 서로 겹치지 않는다.
  const names = Object.keys(parts) as (keyof typeof parts)[];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      expect(overlaps(parts[names[i]!]!, parts[names[j]!]!), `${names[i]} × ${names[j]}`).toBe(
        false,
      );

  // 술래는 감지기·덫, 도망자는 지도 교환과 예약 슬롯을 같은 자리에서 본다.
  await expect(page.locator('.hotbar-slot[data-slot="sensor"]')).toBeVisible();
  await expect(page.locator('.hotbar-slot[data-slot="trap"]')).toBeVisible();
  await page.getByRole('button', { name: '도망자 시점', exact: true }).click();
  await expect(page.locator('.hotbar-slot[data-slot="exchange"]')).toBeVisible();
  await expect(page.locator('.hotbar-slot[data-slot="reserved"]')).toHaveAttribute(
    'data-state',
    'reserved',
  );

  expect(errors).toEqual([]);
});

test('the same overlays fit a 400px wide screen without a sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 780 });
  const errors = await openHud(page);

  const stage = await box(page, '.game-stage');
  for (const selector of [
    '.game-stage > .game-hud',
    '.game-stage > .hotbar',
    '.game-stage > .event-log',
    '.game-stage > .mini-map',
    '.game-stage > .hud-drawer',
  ]) {
    const rect = await box(page, selector);
    expect(rect.x, selector).toBeGreaterThanOrEqual(stage.x - 1);
    expect(rect.x + rect.width, selector).toBeLessThanOrEqual(stage.x + stage.width + 1);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  expect(errors).toEqual([]);
});
