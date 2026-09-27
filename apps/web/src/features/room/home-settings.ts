// S15P21C204-295. 홈 옵션 패널의 설정. 이 기기에만 남고(localStorage) 서버로 가지 않는다.
// 입장할 때 런타임에 한 번 적용한다: 화면 품질은 quality(), 소리는 setAudioPreferences().
import { unitGain } from '../media/audio-preferences';
import { bgmVolumeValue, DEFAULT_BGM_VOLUME } from '../media/match-bgm';
import type { QualityPreset } from '../game/scene/quality-presets';

export type HomeSettings = Readonly<{
  quality: QualityPreset;
  /** 0–1. 원격 얼굴·음성과 안내음의 기본 음량. */
  volume: number;
  /** 0–3. 경기 배경음 음량. 1 이 기준(100%)이고 최대 세 배(300%)다. */
  bgmVolume: number;
  muted: boolean;
  /** 홈 배경 복도의 움직임과 조명 깜빡임. 기기의 동작 줄이기 설정이 더 우선한다. */
  backgroundMotion: boolean;
}>;

export const HOME_SETTINGS_STORAGE_KEY = 'kkakkung.home-settings';

export const DEFAULT_HOME_SETTINGS: HomeSettings = Object.freeze({
  quality: 'medium',
  volume: 0.7,
  bgmVolume: DEFAULT_BGM_VOLUME,
  muted: false,
  backgroundMotion: true,
});

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** 브라우저의 localStorage. 접근 자체가 던지는 환경(비공개 창 등)에서는 null. */
export function homeSettingsStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 저장된 값을 읽되 모르는 값은 항목별로 기본값으로 되돌린다. 깨진 JSON 은 전부 기본값이다. */
export function normalizeHomeSettings(value: unknown): HomeSettings {
  const object =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return Object.freeze({
    quality: object.quality === 'low' ? 'low' : 'medium',
    volume:
      typeof object.volume === 'number' ? unitGain(object.volume) : DEFAULT_HOME_SETTINGS.volume,
    bgmVolume:
      typeof object.bgmVolume === 'number'
        ? bgmVolumeValue(object.bgmVolume)
        : DEFAULT_HOME_SETTINGS.bgmVolume,
    muted: object.muted === true,
    backgroundMotion: object.backgroundMotion !== false,
  });
}

export function loadHomeSettings(storage = homeSettingsStorage()): HomeSettings {
  try {
    const raw = storage?.getItem(HOME_SETTINGS_STORAGE_KEY);
    return raw ? normalizeHomeSettings(JSON.parse(raw)) : DEFAULT_HOME_SETTINGS;
  } catch {
    return DEFAULT_HOME_SETTINGS;
  }
}

/** 저장 실패(용량·비공개 창)는 무시한다. 이번 세션 안에서만 적용된다. */
export function saveHomeSettings(value: HomeSettings, storage = homeSettingsStorage()): void {
  try {
    storage?.setItem(HOME_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeHomeSettings(value)));
  } catch {
    // 의도적으로 무시
  }
}
