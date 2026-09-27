import { describe, expect, it, vi } from 'vitest';
import {
  createMatchBgm,
  MATCH_BGM_LEVEL,
  MATCH_BGM_URL,
  type BgmElement,
  type GestureWaiter,
} from './match-bgm';

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

const playing = { playing: true, volume: 0.7, bgmVolume: 1, muted: false };
const idle = { ...playing, playing: false };

describe('match bgm', () => {
  it('creates nothing before the match plays', () => {
    const createElement = vi.fn(() => fakeElement());
    const bgm = createMatchBgm({ createElement });
    bgm.update(idle);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('loops the fixed file from the start at the listening volume times the base level', () => {
    const element = fakeElement();
    const bgm = createMatchBgm({ createElement: () => element });
    bgm.update(playing);
    expect(element.src).toBe(MATCH_BGM_URL);
    expect(element.loop).toBe(true);
    expect(element.currentTime).toBe(0);
    expect(element.volume).toBeCloseTo(0.7 * MATCH_BGM_LEVEL);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('follows both volumes and mute while playing without starting again', () => {
    const element = fakeElement();
    const bgm = createMatchBgm({ createElement: () => element });
    bgm.update(playing);
    bgm.update({ ...playing, volume: 0.4 });
    expect(element.volume).toBeCloseTo(0.4 * 0.25);
    // 배경음 음량은 기준의 세 배까지 올라가고, 그 위는 잘린다.
    bgm.update({ ...playing, volume: 1, bgmVolume: 3 });
    expect(element.volume).toBeCloseTo(0.75);
    bgm.update({ ...playing, volume: 1, bgmVolume: 9 });
    expect(element.volume).toBeCloseTo(0.75);
    bgm.update({ ...playing, bgmVolume: 0 });
    expect(element.volume).toBe(0);
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

  it('retries on the next gesture when the page has no user activation yet', async () => {
    const warn = vi.fn();
    let retry: (() => void) | null = null;
    const waitForGesture: GestureWaiter = (callback) => {
      retry = callback;
      return () => {};
    };
    const blocked = Object.assign(new Error('play() failed'), { name: 'NotAllowedError' });
    let calls = 0;
    const element = fakeElement(() =>
      calls++ === 0 ? Promise.reject(blocked) : Promise.resolve(),
    );
    const bgm = createMatchBgm({ createElement: () => element, warn, waitForGesture });
    bgm.update(playing);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledOnce();
    expect(retry).not.toBeNull();
    retry!();
    expect(element.play).toHaveBeenCalledTimes(2);
  });

  it('stops waiting for a gesture when the match ends first', async () => {
    const stop = vi.fn();
    const blocked = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    const element = fakeElement(() => Promise.reject(blocked));
    const bgm = createMatchBgm({
      createElement: () => element,
      warn: vi.fn(),
      waitForGesture: () => stop,
    });
    bgm.update(playing);
    await Promise.resolve();
    await Promise.resolve();
    bgm.update(idle);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not wait for a gesture when the file itself fails', async () => {
    const waitForGesture = vi.fn(() => () => {});
    const element = fakeElement(() => Promise.reject(new Error('NotSupportedError')));
    const bgm = createMatchBgm({ createElement: () => element, warn: vi.fn(), waitForGesture });
    bgm.update(playing);
    await Promise.resolve();
    await Promise.resolve();
    expect(waitForGesture).not.toHaveBeenCalled();
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
