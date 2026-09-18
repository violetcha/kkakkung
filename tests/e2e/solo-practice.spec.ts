import { expect, test, type Page } from '@playwright/test';

type Probe = {
  tracks: MediaStreamTrack[];
  workers: Set<Worker>;
  audio: Set<AudioContext>;
  release: (() => void) | null;
};
async function localDevices(page: Page, delayPermission = false) {
  await page.addInitScript(
    ({ delayed }) => {
      const probe: Probe = { tracks: [], workers: new Set(), audio: new Set(), release: null };
      (globalThis as typeof globalThis & { soloProbe: Probe }).soloProbe = probe;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          probe.workers.add(this);
        }
        override terminate() {
          probe.workers.delete(this);
          super.terminate();
        }
      };
      const NativeAudio = window.AudioContext;
      window.AudioContext = class extends NativeAudio {
        constructor(options?: AudioContextOptions) {
          super(options);
          probe.audio.add(this);
        }
        override async close() {
          await super.close();
          probe.audio.delete(this);
        }
      };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 240;
          const paint = () => {
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#728d80';
            context.fillRect(0, 0, 320, 240);
          };
          paint();
          const stream = canvas.captureStream(15);
          const timer = window.setInterval(paint, 60);
          const track = stream.getVideoTracks()[0]!;
          const stop = track.stop.bind(track);
          track.stop = () => {
            window.clearInterval(timer);
            stop();
          };
          probe.tracks.push(track);
          if (delayed)
            await new Promise<void>((resolve) => {
              probe.release = resolve;
            });
          return stream;
        },
      });
    },
    { delayed: delayPermission },
  );
}
async function enter(page: Page) {
  await page.route('**/api/sessions/access', (route) =>
    route.fulfill({ json: { method: 'gitlab-sso' } }),
  );
  await page.goto('/play');
  await page.getByRole('button', { name: '혼자 장치 점검·조작 체험', exact: true }).click();
  await expect(page.getByRole('heading', { name: '혼자 준비해 볼까요?' })).toBeVisible();
}
/**
 * 키를 유지 시간 동안 누른다. 앱의 유지 타이머는 페이지 시계로 돌므로 러너의 벽시계로 기다리면
 * 메인 스레드가 막힌 CI에서 keyup이 그 타이머보다 먼저 처리될 수 있다. 페이지 안에서 기다리면
 * 먼저 걸린 앱 타이머가 반드시 앞서 발화한다(S15P21C204-265 후속).
 */
async function holdKey(page: Page, code: string, ms: number) {
  await page.keyboard.down(code);
  await page.evaluate((delay) => new Promise<void>((done) => setTimeout(done, delay)), ms);
  await page.keyboard.up(code);
}
async function resources(page: Page) {
  return page.evaluate(() => {
    const probe = (globalThis as typeof globalThis & { soloProbe: Probe }).soloProbe;
    return {
      live: probe.tracks.filter((track) => track.readyState === 'live').length,
      workers: probe.workers.size,
      audio: probe.audio.size,
    };
  });
}

test('solo teaches actual keyboard movement and both roles without admission or media requests', async ({
  page,
}) => {
  const admissions: string[] = [];
  await page.addInitScript(() => {
    const probe = { nonViteSockets: 0 };
    (globalThis as typeof globalThis & { soloNetwork: typeof probe }).soloNetwork = probe;
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (protocols !== 'vite-hmr') probe.nonViteSockets++;
      }
    };
  });
  page.on('request', (request) => {
    if (
      /\/api\/(sessions|media|matchmaking)(\/|$|\?)/.test(new URL(request.url()).pathname) &&
      !request.url().includes('/sessions/access')
    )
      admissions.push(request.url());
  });
  await enter(page);
  const progress = page.getByLabel('체험 진행');
  await holdKey(page, 'KeyW', 400);
  await expect(progress.getByText('✓ 완료 · 한 칸 전진', { exact: true })).toBeVisible();
  await holdKey(page, 'KeyS', 600);
  await expect(progress.getByText('✓ 완료 · 한 칸 후진', { exact: true })).toBeVisible();
  await expect(progress.getByText('✓ 완료 · 중립으로 멈추기', { exact: true })).toBeVisible();
  await holdKey(page, 'KeyA', 400);
  await expect(progress.getByText('✓ 완료 · 왼쪽 90° 회전', { exact: true })).toBeVisible();
  // 회전은 키를 놓고 중립 시간(150ms)이 지나야 다음 회전을 받는다(265). 같은 이유로 페이지 시계.
  await page.evaluate(() => new Promise<void>((done) => setTimeout(done, 300)));
  await holdKey(page, 'KeyD', 400);
  await expect(progress.getByText('✓ 완료 · 오른쪽 90° 회전', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '술래 체험', exact: true }).click();
  await page.keyboard.press('KeyF');
  await expect(progress.getByText('✓ 완료 · 술래 · 장비 설치', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '도망자 체험', exact: true }).click();
  await page.keyboard.press('KeyE');
  for (const step of await page.getByLabel('도전 순서').locator('li').allTextContents()) {
    const arrow = step.includes('↑')
      ? 'ArrowUp'
      : step.includes('→')
        ? 'ArrowRight'
        : step.includes('↓')
          ? 'ArrowDown'
          : 'ArrowLeft';
    await page.keyboard.press(arrow);
  }
  await expect(progress.getByText('✓ 완료 · 도망자 · 탈출 도전', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '체험 마치고 방 준비하기', exact: true }).click();
  await expect(page.getByLabel('닉네임')).toBeVisible();
  await page.getByRole('button', { name: '혼자 장치 점검·조작 체험', exact: true }).click();
  await expect(page.locator('[data-completed="true"]')).toHaveCount(0);
  expect(admissions).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { soloNetwork: { nonViteSockets: number } }).soloNetwork
          .nonViteSockets,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: '체험 마치고 방 준비하기', exact: true }).click();
});

test('actual vision Worker and audio lifetime close on hidden-tab handling and restart fresh', async ({
  page,
}) => {
  await localDevices(page);
  await enter(page);
  await page.getByRole('button', { name: '카메라 켜고 점검하기', exact: true }).click();
  await expect(page.getByLabel('내 웹캠 미리보기').locator('video')).toBeVisible();
  await expect.poll(async () => (await resources(page)).workers).toBe(1);
  await expect(page.getByText('얼굴을 찾지 못했습니다.', { exact: false })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(
    page.getByText('다른 탭으로 이동해 카메라와 체험을 종료했어요.', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => resources(page)).toEqual({ live: 0, workers: 0, audio: 0 });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
  await page.getByRole('button', { name: '새 체험 시작하기', exact: true }).click();
  await expect(page.getByLabel('내 웹캠 미리보기').locator('video')).toHaveCount(0);
  await expect(page.locator('[data-completed="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: '체험 마치고 방 준비하기', exact: true }).click();
});

test('closing while permission is pending stops the late stream and does not reopen the next session', async ({
  page,
}) => {
  await localDevices(page, true);
  await enter(page);
  await page.getByRole('button', { name: '카메라 켜고 점검하기', exact: true }).click();
  await expect.poll(async () => (await resources(page)).live).toBe(1);
  await page.getByRole('button', { name: '체험 마치고 방 준비하기', exact: true }).click();
  await expect(page.getByLabel('닉네임')).toBeVisible();
  await page.getByRole('button', { name: '혼자 장치 점검·조작 체험', exact: true }).click();
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { soloProbe: Probe }).soloProbe.release?.();
  });
  await expect.poll(() => resources(page)).toEqual({ live: 0, workers: 0, audio: 0 });
  await expect(page.getByLabel('내 웹캠 미리보기').locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: '체험 마치고 방 준비하기', exact: true }).click();
});
