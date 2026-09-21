import { expect, test, type Page } from '@playwright/test';
import { seedMediaConsent } from './consent';

type AudioProbe = {
  contexts: AudioContext[];
  tracks: MediaStreamTrack[];
  tones: Set<OscillatorNode>;
  analysers: Set<AnalyserNode>;
  captures: number;
};
async function setup(page: Page) {
  await seedMediaConsent(page);
  await page.addInitScript(() => {
    const probe: AudioProbe = {
      contexts: [],
      tracks: [],
      tones: new Set(),
      analysers: new Set(),
      captures: 0,
    };
    (globalThis as typeof globalThis & { audioProbe: AudioProbe }).audioProbe = probe;
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts.push(this);
      }
      override createOscillator() {
        const tone = super.createOscillator();
        probe.tones.add(tone);
        tone.addEventListener('ended', () => probe.tones.delete(tone), { once: true });
        const disconnect = tone.disconnect.bind(tone);
        tone.disconnect = () => {
          disconnect();
          probe.tones.delete(tone);
        };
        return tone;
      }
      override createAnalyser() {
        const analyser = super.createAnalyser();
        probe.analysers.add(analyser);
        const disconnect = analyser.disconnect.bind(analyser);
        analyser.disconnect = () => {
          disconnect();
          probe.analysers.delete(analyser);
        };
        return analyser;
      }
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        probe.captures++;
        if (constraints.audio) {
          // Test input only: generate PCM into a MediaStream, never into speakers.
          const context = probe.contexts[0]!;
          const destination = context.createMediaStreamDestination();
          const oscillator = context.createOscillator();
          oscillator.frequency.value = 330;
          oscillator.connect(destination);
          oscillator.start();
          const track = destination.stream.getAudioTracks()[0]!;
          const stop = track.stop.bind(track);
          track.stop = () => {
            oscillator.stop();
            oscillator.disconnect();
            destination.disconnect();
            stop();
          };
          probe.tracks.push(track);
          return destination.stream;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const draw = () => {
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#788882';
          context.fillRect(0, 0, canvas.width, canvas.height);
        };
        draw();
        const stream = canvas.captureStream(15);
        const timer = window.setInterval(draw, 60);
        const track = stream.getVideoTracks()[0]!;
        const stop = track.stop.bind(track);
        track.stop = () => {
          window.clearInterval(timer);
          stop();
        };
        probe.tracks.push(track);
        return stream;
      },
    });
  });
  await page.route('**/api/sessions/access', (route) =>
    route.fulfill({ json: { method: 'gitlab-sso' } }),
  );
  await page.goto('/play');
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await page.getByRole('button', { name: '튜토리얼', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '혼자 준비해 볼까요?' })).toBeVisible();
}
/** 설정 창의 갈래를 연다. 창이 닫혀 있으면 Esc 로 먼저 연다. */
async function openTab(page: Page, label: string) {
  if (!(await page.getByRole('button', { name: '계속하기', exact: true }).isVisible()))
    await page.keyboard.press('Escape');
  await page.getByRole('button', { name: label, exact: true }).click();
}
async function resources(page: Page) {
  return page.evaluate(() => {
    const probe = (globalThis as typeof globalThis & { audioProbe: AudioProbe }).audioProbe;
    return {
      contexts: probe.contexts.length,
      open: probe.contexts.filter((context) => context.state !== 'closed').length,
      tracks: probe.tracks.filter((track) => track.readyState === 'live').length,
      tones: probe.tones.size,
      analysers: probe.analysers.size,
      captures: probe.captures,
    };
  });
}

test('personal sound check reuses one real Context without capture and resets on exit', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/media\//.test(request.url())) requests.push(request.url());
  });
  await setup(page);
  await openTab(page, '소리');
  const volume = page.getByRole('slider', { name: '듣는 음량', exact: false });
  await expect(volume).toHaveValue('70');
  await page.getByRole('button', { name: '확인음 듣기', exact: true }).click();
  await expect(page.getByText('짧은 확인음이 재생됐습니다.', { exact: false })).toBeVisible();
  await expect
    .poll(() => resources(page))
    .toMatchObject({
      contexts: 1,
      open: 1,
      tracks: 0,
      tones: 0,
      captures: 0,
    });
  await volume.press('Home');
  await expect(volume).toHaveValue('0');
  await page.getByRole('button', { name: '확인음 듣기', exact: true }).click();
  await expect(page.getByText('전체 음소거를 해제하고 음량을 올려 주세요.')).toBeVisible();
  await volume.press('End');
  await page.getByRole('checkbox', { name: '모든 소리 끄기', exact: true }).check();
  await page.getByRole('button', { name: '확인음 듣기', exact: true }).click();
  expect((await resources(page)).tones).toBe(0);
  await page.getByRole('checkbox', { name: '모든 소리 끄기', exact: true }).uncheck();
  await page.getByRole('button', { name: '확인음 듣기', exact: true }).click();
  await page.getByRole('button', { name: '체험 마치기', exact: true }).click();
  await expect.poll(() => resources(page)).toMatchObject({ contexts: 1, open: 0, tones: 0 });
  // 설정은 이 기기에 남는다. 다시 들어오면 마지막 음량(100%)이 그대로 보인다.
  await page.getByRole('button', { name: '튜토리얼', exact: true }).click();
  await openTab(page, '소리');
  await expect(page.getByRole('slider', { name: '듣는 음량', exact: false })).toHaveValue('100');
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: '체험 마치기', exact: true }).click();
});

test('microphone meter follows actual synthetic PCM and releases the borrowed source on mic off', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '카메라 켜고 점검하기', exact: true }).click();
  // S15P21C204-295. 마이크는 장치 갈래의 한 줄이고, 입력 크기는 소리 갈래에서 본다.
  await page.getByRole('button', { name: '연결', exact: true }).click();
  await expect.poll(() => resources(page)).toMatchObject({ contexts: 1, tracks: 2, analysers: 1 });
  await openTab(page, '소리');
  await expect
    .poll(async () =>
      Number(await page.getByLabel('마이크 입력 크기', { exact: true }).getAttribute('value')),
    )
    .toBeGreaterThan(0.05);
  await openTab(page, '카메라 · 장치');
  await expect(page.getByRole('button', { name: '끄기', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '끄기', exact: true }).click();
  await expect.poll(() => resources(page)).toMatchObject({ tracks: 1, analysers: 0, tones: 0 });
  await page.getByRole('button', { name: '체험 마치기', exact: true }).click();
  await expect.poll(() => resources(page)).toMatchObject({ open: 0, tracks: 0, analysers: 0 });
});
