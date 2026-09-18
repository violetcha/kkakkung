import { expect, it } from 'vitest';
import {
  DEFAULT_SCENE_THEME,
  SCENE_THEME_STORAGE_KEY,
  rememberSceneTheme,
  resolveSceneTheme,
} from './scene-theme';

const storageOf = (value: string | null) => ({ getItem: () => value });

it('defaults new and unknown viewers to the backrooms facility', () => {
  expect(DEFAULT_SCENE_THEME).toBe('facility');
  expect(resolveSceneTheme('', storageOf(null))).toBe('facility');
  expect(resolveSceneTheme(null, null)).toBe('facility');
});

it('lets the URL pick a theme, then the saved choice, and ignores unknown values', () => {
  expect(resolveSceneTheme('?theme=facility', storageOf('block'))).toBe('facility');
  expect(resolveSceneTheme('?theme=block', storageOf('facility'))).toBe('block');
  expect(resolveSceneTheme('?other=1', storageOf('facility'))).toBe('facility');
  expect(resolveSceneTheme('?theme=neon', storageOf('facility'))).toBe('facility');
  expect(resolveSceneTheme('?theme=neon', storageOf('neon'))).toBe('facility');
});

it('survives a storage that throws and remembers a choice when it can', () => {
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(resolveSceneTheme('', throwing)).toBe('facility');
  expect(() => rememberSceneTheme('facility', throwing)).not.toThrow();
  const written: Record<string, string> = {};
  rememberSceneTheme('facility', { setItem: (key, value) => void (written[key] = value) });
  expect(written).toEqual({ [SCENE_THEME_STORAGE_KEY]: 'facility' });
});
