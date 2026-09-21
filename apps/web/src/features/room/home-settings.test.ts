import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOME_SETTINGS,
  HOME_SETTINGS_STORAGE_KEY,
  loadHomeSettings,
  normalizeHomeSettings,
  saveHomeSettings,
} from './home-settings';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('home settings', () => {
  it('falls back to defaults when nothing is stored, the JSON is broken or storage throws', () => {
    expect(loadHomeSettings(memoryStorage())).toEqual(DEFAULT_HOME_SETTINGS);
    expect(loadHomeSettings(memoryStorage({ [HOME_SETTINGS_STORAGE_KEY]: '{oops' }))).toEqual(
      DEFAULT_HOME_SETTINGS,
    );
    expect(
      loadHomeSettings({
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => undefined,
      }),
    ).toEqual(DEFAULT_HOME_SETTINGS);
    expect(loadHomeSettings(null)).toEqual(DEFAULT_HOME_SETTINGS);
  });

  it('keeps each stored field only when it is valid and clamps the volume', () => {
    expect(
      normalizeHomeSettings({ quality: 'low', volume: 1.7, muted: true, backgroundMotion: false }),
    ).toEqual({ quality: 'low', volume: 1, muted: true, backgroundMotion: false });
    expect(normalizeHomeSettings({ quality: 'ultra', volume: 'loud', muted: 'yes' })).toEqual(
      DEFAULT_HOME_SETTINGS,
    );
    expect(normalizeHomeSettings(null)).toEqual(DEFAULT_HOME_SETTINGS);
  });

  it('round-trips through storage and ignores a storage that refuses writes', () => {
    const storage = memoryStorage();
    const value = { quality: 'low', volume: 0.25, muted: false, backgroundMotion: false } as const;
    saveHomeSettings(value, storage);
    expect(loadHomeSettings(storage)).toEqual(value);
    expect(() =>
      saveHomeSettings(value, {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
    ).not.toThrow();
  });
});
