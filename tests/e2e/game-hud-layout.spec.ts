import { expect, test, type Page } from '@playwright/test';

// S15P21C204-279. 백룸 경기 화면 오버레이 배치. /preview 의 합성 fixture 만 쓴다.
async function openHud(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/preview');
  await page.getByRole('button', { name: '경기 HUD', exact: true }).click();
  await expect(page.locator('.game-stage')).toBeVisible();
  return errors;
}

/** 화면 위 사각형. 오버레이가 무대 안에 있는지 보는 데 쓴다. */
const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`${selector} 없음`);
  return rect;
};

test('the camcorder frame, five-slot hotbar and minimap sit over a full-bleed 3D stage', async ({
  page,
}) => {
  const errors = await openHud(page);

  // 3D 는 무대 전체를 채운다.
  const stage = await box(page, '.game-stage');
  const canvas = await box(page, '.game-stage > .product-canvas');
  expect(Math.abs(canvas.width - stage.width)).toBeLessThan(6);
  expect(Math.abs(canvas.height - stage.height)).toBeLessThan(6);

  const camera = await box(page, '.game-stage > .camcorder-overlay');
  expect(Math.abs(camera.width - stage.width)).toBeLessThan(6);
  expect(Math.abs(camera.height - stage.height)).toBeLessThan(6);
  await expect(page.getByLabel('녹화 중 00:00:04')).toBeVisible();
  await expect(page.locator('.game-stage > .event-log')).toHaveCount(0);
  await expect(page.locator('.game-stage > .game-hud')).toHaveCount(0);
  await expect(page.locator('.game-status-a11y .game-hud')).toBeAttached();

  // 조작 오버레이가 모두 무대 안에 있다.
  const parts = {
    hotbar: await box(page, '.game-stage > .hotbar'),
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

  // 핫바는 아래 가운데, 미니맵은 우하단, 십자선은 화면 가운데다.
  await expect(page.locator('.game-stage > .hotbar .hotbar-slot')).toHaveCount(5);
  expect(parts.hotbar.y).toBeGreaterThan(stage.y + stage.height / 2);
  expect(
    Math.abs(parts.hotbar.x + parts.hotbar.width / 2 - (stage.x + stage.width / 2)),
  ).toBeLessThan(3);
  expect(parts.minimap.x).toBeGreaterThan(stage.x + stage.width / 2);
  expect(parts.minimap.y).toBeGreaterThan(stage.y + stage.height / 2);
  expect(
    Math.abs(parts.crosshair.x + parts.crosshair.width / 2 - (stage.x + stage.width / 2)),
  ).toBeLessThan(3);
  expect(
    Math.abs(parts.crosshair.y + parts.crosshair.height / 2 - (stage.y + stage.height / 2)),
  ).toBeLessThan(3);

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

// S15P21C204-278. 장비를 쓸 수 있다는 것을 화면이 먼저 알려 준다.
test('the hotbar and crosshair say whether the selected equipment can go here', async ({
  page,
}) => {
  const errors = await openHud(page);
  const crosshair = page.locator('.game-stage > .crosshair');
  const hint = page.locator('.hotbar-hint');

  // 기본 열린 복도에서는 막힌 이유를 그 자리에서 알려 준다.
  await expect(crosshair).toHaveAttribute('data-install', 'blocked');
  await expect(hint).toHaveAttribute('data-ready', 'false');
  await expect(hint).toContainText('벽을 마주 보고');

  // 검수용 앞 벽을 켜면 십자선과 안내 줄이 함께 '가능'을 말한다.
  await page.getByRole('button', { name: '설치 가능 칸 켜기', exact: true }).click();
  await expect(crosshair).toHaveAttribute('data-install', 'ready');
  await expect(hint).toHaveAttribute('data-ready', 'true');
  await expect(hint).toContainText('설치할 수 있어요');

  await page.getByRole('button', { name: '설치 가능 칸 끄기', exact: true }).click();
  await expect(crosshair).toHaveAttribute('data-install', 'blocked');

  // 덫은 바닥에 놓으므로 같은 자리에서 다시 가능해진다.
  await page.locator('.hotbar-slot[data-slot="trap"]').click();
  await expect(crosshair).toHaveAttribute('data-install', 'ready');
  await expect(page.locator('.hotbar-slot[data-slot="trap"]')).toHaveAttribute(
    'data-state',
    'selected',
  );

  // 도망자에게는 설치 안내가 없다.
  await page.getByRole('button', { name: '도망자 시점', exact: true }).click();
  await expect(crosshair).toHaveAttribute('data-install', 'none');
  await expect(hint).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('the camcorder HUD keeps five slots and a minimap inside a 400px screen', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 780 });
  const errors = await openHud(page);

  const stage = await box(page, '.game-stage');
  for (const selector of [
    '.game-stage > .camcorder-overlay',
    '.game-stage > .hotbar',
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
  await expect(page.locator('.game-stage > .hotbar .hotbar-slot')).toHaveCount(5);
  await expect(page.locator('.game-stage > .event-log')).toHaveCount(0);

  expect(errors).toEqual([]);
});
