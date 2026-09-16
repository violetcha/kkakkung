import { describe, expect, it, vi } from 'vitest';
import { createAudioCues } from './audio-cues';
import { createCueBuffer, CUE_KINDS } from './cue-buffer';

function fakeContext(state: AudioContextState = 'running') {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const context = {
    state,
    sampleRate: 8000,
    destination: node(),
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = new Float32Array(length);
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
    createBufferSource: vi.fn(() => ({
      ...node(),
      buffer: null as AudioBuffer | null,
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    })),
    createGain: vi.fn(() => ({ ...node(), gain: { value: 0 } })),
  };
  return { context, cues: createAudioCues(context as unknown as AudioContext) };
}

describe('cue buffers', () => {
  it('renders every kind as bounded, non-silent mono PCM with a soft attack and release', () => {
    const { context } = fakeContext();
    for (const kind of CUE_KINDS) {
      const buffer = createCueBuffer(context as unknown as AudioContext, kind);
      const samples = buffer.getChannelData(0);
      expect(samples.length).toBeGreaterThan(400);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(1);
      expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(0.05);
      expect(Math.abs(samples[0]!)).toBeLessThan(0.01);
      expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.01);
      expect(samples.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('audio cues on the device context', () => {
  it('connects to the destination instead of the lockable master gain and releases ended nodes', () => {
    const { context, cues } = fakeContext();
    expect(cues.play('captured', 0.7)).toBe(true);
    const source = context.createBufferSource.mock.results[0]!.value;
    const gain = context.createGain.mock.results[0]!.value;
    expect(source.buffer).not.toBeNull();
    expect(source.start).toHaveBeenCalledOnce();
    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
    expect(gain.gain.value).toBeCloseTo(0.7 * 0.35);
    expect(cues.activeCount).toBe(1);
    source.onended?.();
    expect(cues.activeCount).toBe(0);
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });
  it('reuses one buffer per kind and refuses silent volume, suspended context and disposed player', () => {
    const { context, cues } = fakeContext();
    cues.play('countdown', 1);
    cues.play('countdown', 1);
    const [first, second] = context.createBufferSource.mock.results.map((r) => r.value.buffer);
    expect(first).toBe(second);
    expect(cues.play('countdown', 0)).toBe(false);
    expect(cues.play('countdown', NaN)).toBe(false);
    cues.dispose();
    expect(cues.activeCount).toBe(0);
    expect(
      context.createBufferSource.mock.results.every((r) => r.value.stop.mock.calls.length === 1),
    ).toBe(true);
    expect(cues.play('countdown', 1)).toBe(false);
    const suspended = fakeContext('suspended');
    expect(suspended.cues.play('start', 1)).toBe(false);
  });
});
