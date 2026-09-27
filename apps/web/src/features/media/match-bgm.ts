import { unitGain } from './audio-preferences';

/**
 * 경기(PLAYING) 동안만 반복 재생하는 배경음. 파일은 `apps/web/public` 아래 이 경로에 둔다.
 * 경로 조각을 셋으로 둔 것은 nginx 가 `/a/b` 두 조각 주소를 게임 소켓으로 넘기기 때문이다.
 * 파일이 없으면 조용히 재생하지 않는다.
 */
export const MATCH_BGM_URL = '/audio/bgm/match.mp3';
/**
 * 전체 음량 대비 배경음 크기. 경기 중에는 발소리·장비 소리·근거리 음성이 판단 근거라 작게 둔다.
 */
export const MATCH_BGM_LEVEL = 0.25;

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

export type MatchBgmState = Readonly<{ playing: boolean; volume: number; muted: boolean }>;

export interface MatchBgm {
  update(state: MatchBgmState): void;
  dispose(): void;
}

const browserElement = (): BgmElement | null => (typeof Audio === 'function' ? new Audio() : null);

/**
 * 장치 점검 등 앞선 클릭으로 페이지에 사용자 활성화가 있어 audio element 재생이 허용된다. 출력
 * 잠금은 서버 승인 소리에만 걸리므로 배경음에는 적용하지 않고, 음량·음소거만 따른다.
 */
export function createMatchBgm(
  options: {
    createElement?: () => BgmElement | null;
    url?: string;
    warn?: (message: string) => void;
  } = {},
): MatchBgm {
  const createElement = options.createElement ?? browserElement;
  const url = options.url ?? MATCH_BGM_URL;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  let element: BgmElement | null = null;
  let started = false;
  let warned = false;
  let disposed = false;
  let run = 0;

  return {
    update({ playing, volume, muted }) {
      if (disposed) return;
      const level = muted ? 0 : unitGain(volume) * MATCH_BGM_LEVEL;
      if (!playing) {
        if (!started || !element) return;
        started = false;
        run++;
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
      element.play().catch((cause: unknown) => {
        // 재생이 시작되기 전에 경기가 끝나 멈춘 경우는 실패가 아니다.
        if (current !== run || disposed || warned) return;
        warned = true;
        const reason = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
        warn(`[kkakkung] 경기 배경음을 재생하지 못했습니다(${url}): ${reason}`);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      run++;
      if (!element) return;
      element.pause();
      element.removeAttribute('src');
      element.load();
      element = null;
    },
  };
}
