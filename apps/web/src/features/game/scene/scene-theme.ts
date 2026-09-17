/**
 * S15P21C204-268. Which look the product renderer draws. `block` is the decided direction
 * (Minecraft-like block forms and pixel textures, our own darkness and 3.5-cell sight); the
 * older `facility` corridor stays selectable so the demo room and existing inspections can be
 * compared side by side. Selection never reaches the server: it is a local rendering choice.
 */
export const SCENE_THEME_IDS = ['block', 'facility'] as const;
export type SceneThemeId = (typeof SCENE_THEME_IDS)[number];
export const DEFAULT_SCENE_THEME: SceneThemeId = 'block';
/** Query parameter and storage key share one name so `?theme=facility` can be bookmarked. */
export const SCENE_THEME_KEY = 'theme';
export const SCENE_THEME_STORAGE_KEY = 'kkakkung.scene-theme';

export const SCENE_THEME_LABELS: Readonly<Record<SceneThemeId, string>> = Object.freeze({
  block: '어두운 블록',
  facility: '시설 복도',
});

export function isSceneThemeId(value: unknown): value is SceneThemeId {
  return typeof value === 'string' && (SCENE_THEME_IDS as readonly string[]).includes(value);
}

/**
 * URL first, then the viewer's saved choice, then the default. Both inputs are optional so the
 * resolution can run in tests and on the server-side-less preview without a window.
 */
export function resolveSceneTheme(
  search: string | null | undefined = typeof location === 'undefined' ? null : location.search,
  storage: Pick<Storage, 'getItem'> | null | undefined = safeStorage(),
): SceneThemeId {
  const fromUrl = search ? new URLSearchParams(search).get(SCENE_THEME_KEY) : null;
  if (isSceneThemeId(fromUrl)) return fromUrl;
  const saved = readSaved(storage);
  return isSceneThemeId(saved) ? saved : DEFAULT_SCENE_THEME;
}

function readSaved(storage: Pick<Storage, 'getItem'> | null | undefined): string | null {
  try {
    return storage?.getItem(SCENE_THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function rememberSceneTheme(
  theme: SceneThemeId,
  storage: Pick<Storage, 'setItem'> | null | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(SCENE_THEME_STORAGE_KEY, theme);
  } catch {
    // A private window or blocked storage only loses the convenience, never the render.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
