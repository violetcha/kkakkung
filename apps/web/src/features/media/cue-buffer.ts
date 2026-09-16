/**
 * S15P21C204-261. 자기 상태 안내음. 서버가 승인한 위치 효과음(effect-buffer)과 달리 내 화면에
 * 이미 보이는 사실(구속·포획·탈출·교환·카운트다운·승패)만 알린다. 전부 코드로 만든 PCM이며
 * 외부 음원 자산은 없다.
 */
export const CUE_KINDS = [
  'countdown',
  'start',
  'restrained',
  'captured',
  'escaped',
  'exit-failed',
  'exchange-offer',
  'exchange-completed',
  'ally-progress',
  'enemy-progress',
  'victory',
  'defeat',
  'aborted',
] as const;
export type CueKind = (typeof CUE_KINDS)[number];

const DURATION_S: Record<CueKind, number> = {
  countdown: 0.1,
  start: 0.32,
  restrained: 0.42,
  captured: 0.7,
  escaped: 0.6,
  'exit-failed': 0.28,
  'exchange-offer': 0.34,
  'exchange-completed': 0.36,
  'ally-progress': 0.3,
  'enemy-progress': 0.3,
  victory: 1.0,
  defeat: 1.0,
  aborted: 0.55,
};

const TWO_PI = 2 * Math.PI;
const tone = (hz: number, t: number) => Math.sin(TWO_PI * hz * t);
/** 두 음을 차례로 낸다. `split` 이전은 첫 음, 이후는 둘째 음. */
const twoNotes = (first: number, second: number, split: number, t: number, duration: number) => {
  const local = t < split ? t : t - split;
  const length = t < split ? split : duration - split;
  return tone(t < split ? first : second, t) * Math.sin((Math.PI * local) / length);
};
const chord = (notes: readonly number[], t: number) =>
  notes.reduce((sum, hz) => sum + tone(hz, t), 0) / notes.length;

function sample(kind: CueKind, t: number, noise: number, duration: number): number {
  switch (kind) {
    case 'countdown':
      return 0.6 * tone(880, t) * Math.exp(-30 * t);
    case 'start':
      return 0.6 * twoNotes(660, 990, 0.14, t, duration);
    case 'restrained': {
      // 쇳소리: 짧은 잡음 타격 뒤 낮은 금속 울림.
      const strike = noise * Math.exp(-60 * t);
      const ring = (tone(210, t) + 0.5 * tone(315, t)) * Math.exp(-7 * t);
      return 0.55 * strike + 0.4 * ring * (0.7 + 0.3 * tone(18, t));
    }
    case 'captured': {
      // 220Hz에서 110Hz로 미끄러지는 낮은 음과 잡음.
      const hz = 220 - 110 * Math.min(1, t / duration);
      return (0.55 * Math.sin(TWO_PI * hz * t) + 0.2 * noise) * Math.exp(-3 * t);
    }
    case 'escaped': {
      const step = Math.min(2, Math.floor(t / 0.16));
      const hz = [523.25, 659.25, 783.99][step]!;
      return 0.55 * tone(hz, t) * Math.exp(-4 * (t - step * 0.16));
    }
    case 'exit-failed':
      // 사각파에 가까운 낮은 버저.
      return 0.4 * Math.sign(tone(150, t)) * (0.6 + 0.4 * tone(7, t)) * Math.exp(-4 * t);
    case 'exchange-offer':
      return 0.45 * twoNotes(740, 988, 0.17, t, duration);
    case 'exchange-completed':
      return 0.5 * (tone(1046.5, t) + 0.4 * tone(2093, t)) * Math.exp(-6 * t);
    case 'ally-progress':
      return 0.5 * twoNotes(587.33, 698.46, 0.15, t, duration);
    case 'enemy-progress':
      return 0.5 * twoNotes(440, 329.63, 0.15, t, duration);
    case 'victory':
      return 0.5 * chord([523.25, 659.25, 783.99, 1046.5], t) * Math.exp(-2.2 * t);
    case 'defeat': {
      const drop = 1 - 0.06 * Math.min(1, t / duration);
      return 0.5 * chord([220 * drop, 261.63 * drop, 311.13 * drop], t) * Math.exp(-2 * t);
    }
    case 'aborted':
      return 0.45 * tone(330 + 12 * tone(5, t), t) * Math.exp(-3 * t);
  }
}

/** 안내음 하나의 PCM 버퍼. 모노, Context 샘플레이트, 클릭 방지 attack/release 포함. */
export function createCueBuffer(
  context: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer'>,
  kind: CueKind,
): AudioBuffer {
  const duration = DURATION_S[kind];
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * duration),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  let seed = 977;
  for (let i = 0; i < samples.length; i++) {
    const t = i / context.sampleRate;
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = (seed / 0x100000000) * 2 - 1;
    const value = sample(kind, t, noise, duration);
    samples[i] =
      value * Math.min(1, t / 0.004, (samples.length - 1 - i) / (context.sampleRate * 0.02));
  }
  return buffer;
}
