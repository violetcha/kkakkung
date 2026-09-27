import { unitGain } from './audio-preferences';

/**
 * 경기(PLAYING) 동안만 반복 재생하는 배경음. 파일은 `apps/web/public` 아래 이 경로에 둔다.
 * 경로 조각을 셋으로 둔 것은 nginx 가 `/a/b` 두 조각 주소를 게임 소켓으로 넘기기 때문이다.
 * 파일이 없으면 조용히 재생하지 않는다.
 */
export const MATCH_BGM_URL = '/audio/bgm/match.mp3';
/**
 * 배경음 음량 100% 일 때 듣는 음량에 곱하는 비율. 경기 중에는 발소리·장비 소리·근거리 음성이
 * 판단 근거라 기준은 작게 둔다.
 */
export const MATCH_BGM_LEVEL = 0.25;
/** 배경음 음량 기본값. 1 이 기준 크기(100%)다. */
export const DEFAULT_BGM_VOLUME = 1;
/** 배경음 음량 최대치. 기준의 세 배(300%)까지 올린다. 듣는 음량 100% 에서 0.75 로 1 을 넘지 않는다. */
export const MAX_BGM_VOLUME = 3;

/** 배경음 음량을 0–MAX_BGM_VOLUME 로 자른다. 숫자가 아니면 0. */
export const bgmVolumeValue = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(MAX_BGM_VOLUME, value)) : 0;

/** HTMLAudioElement 의 필요한 부분만. 시험은 가짜를 준다. */
export type BgmElement = {
  src: string;
  loop: boolean;
  preload: string;
  volume: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  removeAttribute(name: 'src'): void;
  load(): void;
};

export type MatchBgmState = Readonly<{
  playing: boolean;
  /** 듣는 음량(0–1). */
  volume: number;
  /** 배경음 음량(0–MAX_BGM_VOLUME, 1 = 100%). */
  bgmVolume: number;
  muted: boolean;
}>;

export interface MatchBgm {
  update(state: MatchBgmState): void;
  dispose(): void;
}

/** 다음 사용자 조작(클릭·터치·키)에 한 번 부른다. 해제 함수를 돌려준다. */
export type GestureWaiter = (retry: () => void) => () => void;

const browserElement = (): BgmElement | null => (typeof Audio === 'function' ? new Audio() : null);

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;
const browserGesture: GestureWaiter = (retry) => {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    off();
    retry();
  };
  const off = () => {
    for (const type of GESTURES) window.removeEventListener(type, handler, true);
  };
  for (const type of GESTURES) window.addEventListener(type, handler, true);
  return off;
};

/**
 * 출력 잠금은 서버 승인 소리에만 걸리므로 배경음에는 적용하지 않고, 음량·음소거만 따른다.
 *
 * 브라우저는 사용자 조작이 한 번도 없었던 페이지의 재생을 막는다(NotAllowedError). 장치 점검의
 * 클릭이 보통 이를 풀지만, 경기 중 새로고침해 클릭 없이 자동 재입장한 페이지는 막힌 채로 경기에
 * 들어온다. 그때는 다음 클릭·키 입력에서 다시 재생한다.
 */
export function createMatchBgm(
  options: {
    createElement?: () => BgmElement | null;
    url?: string;
    warn?: (message: string) => void;
    waitForGesture?: GestureWaiter;
  } = {},
): MatchBgm {
  const createElement = options.createElement ?? browserElement;
  const url = options.url ?? MATCH_BGM_URL;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const waitForGesture = options.waitForGesture ?? browserGesture;
  let element: BgmElement | null = null;
  let started = false;
  let warned = false;
  let disposed = false;
  let run = 0;
  let stopWaiting: (() => void) | null = null;

  const clearWait = () => {
    stopWaiting?.();
    stopWaiting = null;
  };
  const play = (target: BgmElement, current: number) => {
    target.play().catch((cause: unknown) => {
      // 재생이 시작되기 전에 경기가 끝나 멈춘 경우는 실패가 아니다.
      if (current !== run || disposed) return;
      const name = (cause as { name?: unknown } | null)?.name;
      const blocked = name === 'NotAllowedError';
      if (!warned) {
        warned = true;
        const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
        warn(
          `[kkakkung] 경기 배경음을 재생하지 못했습니다(${url}): ${reason}` +
            (blocked ? ' · 다음 클릭·키 입력에서 다시 재생합니다' : ''),
        );
      }
      if (!blocked) return;
      clearWait();
      stopWaiting = waitForGesture(() => {
        stopWaiting = null;
        if (current === run && !disposed && started) play(target, current);
      });
    });
  };

  return {
    update({ playing, volume, bgmVolume, muted }) {
      if (disposed) return;
      const level = muted
        ? 0
        : Math.min(1, unitGain(volume) * MATCH_BGM_LEVEL * bgmVolumeValue(bgmVolume));
      if (!playing) {
        if (!started || !element) return;
        started = false;
        run++;
        clearWait();
        element.pause();
        element.currentTime = 0;
        return;
      }
      if (started) {
        if (element && element.volume !== level) element.volume = level;
        return;
      }
      if (!element) {
        element = createElement();
        if (!element) return;
        element.loop = true;
        element.preload = 'auto';
        element.src = url;
      }
      started = true;
      const current = ++run;
      element.volume = level;
      element.currentTime = 0;
      play(element, current);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      run++;
      clearWait();
      if (!element) return;
      element.pause();
      element.removeAttribute('src');
      element.load();
      element = null;
    },
  };
}
