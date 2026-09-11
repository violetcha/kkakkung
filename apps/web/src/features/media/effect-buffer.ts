import type { AudioEffect } from './audio-policy';

/** Local PCM assets for the three server-approved effects; no network or map data needed. */
export function createEffectBuffer(
  context: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer'>,
  kind: AudioEffect['kind'],
): AudioBuffer {
  const duration = { footstep: 0.16, sensor: 0.3, trap: 0.24 }[kind];
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * duration),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  let seed = 173;
  let lowNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / context.sampleRate;
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = (seed / 0x100000000) * 2 - 1;
    lowNoise += 0.12 * (noise - lowNoise);
    let sample: number;
    if (kind === 'footstep') {
      sample = (0.65 * Math.sin(2 * Math.PI * 95 * t) + 0.35 * lowNoise) * Math.exp(-25 * t);
    } else if (kind === 'sensor') {
      const pulse = t < 0.14 ? t : t - 0.16;
      const envelope = pulse >= 0 && pulse < 0.12 ? Math.sin((Math.PI * pulse) / 0.12) ** 2 : 0;
      sample = 0.5 * Math.sin(2 * Math.PI * (t < 0.14 ? 880 : 1175) * t) * envelope;
    } else {
      sample = (0.5 * noise + 0.3 * Math.sin(2 * Math.PI * 1700 * t)) * Math.exp(-20 * t);
    }
    // Short attack/release avoids clicks when the one-shot reaches either boundary.
    samples[i] =
      sample * Math.min(1, t / 0.004, (samples.length - 1 - i) / (context.sampleRate * 0.018));
  }
  return buffer;
}
