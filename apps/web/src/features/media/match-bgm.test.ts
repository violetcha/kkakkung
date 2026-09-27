import { describe, expect, it, vi } from 'vitest';
import { createMatchBgm, MATCH_BGM_URL, type BgmElement } from './match-bgm';

function fakeElement(play: () => Promise<void> = async () => {}) {
  const element = {
    src: '',
    loop: false,
    preload: '',
    volume: 1,
    currentTime: 0,
    play: vi.fn(play),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
  return element satisfies BgmElement;
}

const playing = { playing: true, volume: 0.7, bgmVolume: 0.25, muted: false };
const idle = { ...playing, playing: false };

describe('match bgm', () => {
  it('creates nothing before the match plays', () => {
    const createElement = vi.fn(() => fakeElement());
    const bgm = createMatchBgm({ createElement });
    bgm.update(idle);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('loops the fixed file from the start at the listening volume times the bgm volume', () => {
    const element = fakeElement();
    const bgm = createMatchBgm({ createElement: () => element });
    bgm.update(playing);
    expect(element.src).toBe(MATCH_BGM_URL);
    expect(element.loop).toBe(true);
    expect(element.currentTime).toBe(0);
    expect(element.volume).toBeCloseTo(0.7 * 0.25);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('follows both volumes and mute while playing without starting again', () => {
    const element = fakeElement();
    const bgm = createMatchBgm({ createElement: () => element });
    bgm.update(playing);
    bgm.update({ ...playing, volume: 0.4 });
    expect(element.volume).toBeCloseTo(0.4 * 0.25);
    bgm.update({ ...playing, volume: 0.4, bgmVolume: 1 });
    expect(element.volume).toBeCloseTo(0.4);
    bgm.update({ ...playing, bgmVolume: 1.7 });
    expect(element.volume).toBeCloseTo(0.7);
    bgm.update({ ...playing, muted: true });
    expect(element.volume).toBe(0);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('stops and rewinds when the match ends, then restarts from the top next match', () => {
    const element = fakeElement();
    const createElement = vi.fn(() => element);
    const bgm = createMatchBgm({ createElement });
    bgm.update(playing);
    element.currentTime = 42;
    bgm.update(idle);
    expect(element.pause).toHaveBeenCalledOnce();
    expect(element.currentTime).toBe(0);
    bgm.update(idle);
    expect(element.pause).toHaveBeenCalledOnce();
    bgm.update(playing);
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(createElement).toHaveBeenCalledOnce();
  });

  it('stays silent when the file is missing, warns once and retries next match', async () => {
    const warn = vi.fn();
    const element = fakeElement(() => Promise.reject(new Error('NotSupportedError')));
    const bgm = createMatchBgm({ createElement: () => element, warn });
    bgm.update(playing);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledOnce();
    bgm.update(idle);
    bgm.update(playing);
    await Promise.resolve();
    await Promise.resolve();
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not warn when the match ended before playback began', async () => {
    const warn = vi.fn();
    const element = fakeElement(() => Promise.reject(new Error('AbortError')));
    const bgm = createMatchBgm({ createElement: () => element, warn });
    bgm.update(playing);
    bgm.update(idle);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing without browser audio', () => {
    const bgm = createMatchBgm({ createElement: () => null });
    expect(() => {
      bgm.update(playing);
      bgm.update(idle);
      bgm.dispose();
    }).not.toThrow();
  });

  it('releases the file on dispose and ignores later updates', () => {
    const element = fakeElement();
    const bgm = createMatchBgm({ createElement: () => element });
    bgm.update(playing);
    bgm.dispose();
    expect(element.pause).toHaveBeenCalledOnce();
    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    expect(element.load).toHaveBeenCalledOnce();
    bgm.update(playing);
    expect(element.play).toHaveBeenCalledOnce();
  });
});
