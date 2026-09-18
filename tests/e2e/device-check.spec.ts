import { expect, test, type Page } from '@playwright/test';

// S15P21C204-273. 장치 점검 캐러셀. /preview 의 합성 상태만 쓰고 실제 장치·방은 열지 않는다.
async function openDeviceCheck(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/preview');
  await page.getByRole('button', { name: '장치 점검', exact: true }).click();
  await expect(page.getByRole('heading', { name: '플레이 전 장치 점검' })).toBeVisible();
  return errors;
}

const stage = (page: Page, name: string) => page.getByTestId('device-stage').selectOption(name);
const step = (page: Page, name: string) => page.getByRole('heading', { name });

test('walks the device check one step at a time and keeps each error in its own step', async ({
  page,
}) => {
  const errors = await openDeviceCheck(page);

  // 점검 전에는 첫 단계에서 시작한다. 앞 단계는 없다.
  await expect(step(page, '1 · 카메라')).toBeVisible();
  await expect(step(page, '2 · 자세')).toBeHidden();
  await expect(page.getByRole('button', { name: '이전 단계' })).toBeDisabled();
  // 막힌 단계에 갇히지 않게 앞으로는 직접 넘어갈 수 있고, 진행표시는 상태를 그대로 알린다.
  await page.getByRole('button', { name: '다음 단계' }).click();
  await expect(step(page, '2 · 자세')).toBeVisible();
  await page.getByRole('button', { name: '이전 단계' }).click();
  await expect(step(page, '1 · 카메라')).toBeVisible();

  // 카메라가 통과하면 자세 단계로 넘어가고 동작 확인 두 줄이 보인다.
  await stage(page, '카메라 통과');
  await expect(step(page, '2 · 자세')).toBeVisible();
  await expect(step(page, '1 · 카메라')).toBeHidden();
  const motion = page.getByRole('list', { name: '동작 확인' });
  await expect(motion).toContainText('앞으로 기울이기');
  await expect(motion).toContainText('고개 돌리기');

  // 지나온 단계로는 돌아갈 수 있고, 다시 진행 중인 단계로 나올 수 있다.
  await page.getByRole('button', { name: '이전 단계' }).click();
  await expect(step(page, '1 · 카메라')).toBeVisible();
  await page.getByRole('button', { name: '다음 단계' }).click();
  await expect(step(page, '2 · 자세')).toBeVisible();

  // 보정 오류는 그 오류를 낸 자세 단계 안에서만 보인다.
  await stage(page, '보정 실패');
  await expect(step(page, '2 · 자세')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('얼굴을 찾지 못했습니다');
  await page.getByRole('button', { name: '이전 단계' }).click();
  await expect(step(page, '1 · 카메라')).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();

  // 전부 통과하면 마지막 단계에서만 준비 완료를 누를 수 있다.
  await stage(page, '소리 통과');
  await expect(step(page, '4 · 완료')).toBeVisible();
  await expect(page.getByRole('button', { name: '준비 완료' })).toBeEnabled();

  expect(errors).toEqual([]);
});
