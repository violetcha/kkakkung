import { expect, it } from 'vitest';
import { createEffectBuffer } from './effect-buffer';

it.each([44100, 48000])(
  'generates finite, audible, distinct one-shot PCM at %i Hz',
  (sampleRate) => {
    const context = {
      sampleRate,
      createBuffer: (channels: number, length: number, rate: number) => {
        expect(channels).toBe(1);
        expect(rate).toBe(sampleRate);
        const data = new Float32Array(length);
        return { getChannelData: () => data } as unknown as AudioBuffer;
      },
    };
    const energies: number[] = [];
    for (const kind of ['footstep', 'sensor', 'trap'] as const) {
      const data = createEffectBuffer(context, kind).getChannelData(0);
      expect(data.length / sampleRate).toBeGreaterThanOrEqual(0.1);
      expect(data.length / sampleRate).toBeLessThanOrEqual(0.31);
      expect(data.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
      const energy = Math.sqrt(
        data.reduce((sum, sample) => sum + sample * sample, 0) / data.length,
      );
      expect(energy).toBeGreaterThan(0.02);
      expect(Math.abs(data[0]!)).toBe(0);
      expect(Math.abs(data.at(-1)!)).toBe(0);
      energies.push(energy);
    }
    expect(new Set(energies).size).toBe(3);
  },
);
