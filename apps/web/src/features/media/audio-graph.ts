// D-16 / ME-06. 근거리 음성과 효과음의 WebAudio 그래프.
// SID당 Source→Filter→Gain→Panner→Destination을 한 번만 연결한다.
// audio element attach 재생을 추가하지 않는다. gain=0은 접근 차단이 아니라 표현층 mute다.
import type { AudioEffect, ResolvedVoice } from './audio-policy';

/** COUNTDOWN·개인 종료·권위 상실에서 출력을 잠근다. */
export type OutputLock = 'open' | 'locked';

export interface AudioNodeLike {
  connect(target: AudioNodeLike): void;
  disconnect(): void;
}

export interface GainLike extends AudioNodeLike {
  gainValue: number;
}

export interface FilterLike extends AudioNodeLike {
  frequency: number;
}

export interface PannerLike extends AudioNodeLike {
  /** 방위각만 쓴다. 원본 월드 좌표를 요구하지 않는다. */
  azimuthRad: number;
}

export interface SourceLike extends AudioNodeLike {
  start?(): void;
  stop?(): void;
}

/** 사용자 제스처로 이미 열린 AudioContext를 재사용한다. */
export interface AudioGraphEnvironment {
  createSourceFromTrack(track: MediaStreamTrack): SourceLike;
  createEffectSource(kind: AudioEffect['kind']): SourceLike;
  createGain(): GainLike;
  createFilter(): FilterLike;
  createPanner(): PannerLike;
  readonly destination: AudioNodeLike;
  readonly masterGain: GainLike;
}

export type AudioGraphDeps = Readonly<{
  environment: AudioGraphEnvironment;
  /** 검증된 SDK 오디오 트랙 조회. 없으면 그래프를 만들지 않는다. */
  getAudioTrack(trackSid: string): MediaStreamTrack | null;
}>;

export type VoiceChain = Readonly<{
  trackSid: string;
  playerId: string;
  publisherGeneration: number;
  source: SourceLike;
  filter: FilterLike;
  gain: GainLike;
  panner: PannerLike;
}>;

export interface AudioGraph {
  /** 정책·바인딩·트랙 세 입력이 일치하는 voice만 연결한다. */
  reconcileVoices(voices: readonly ResolvedVoice[]): void;
  /** 승인된 효과음만 서버 eventId로 중복 없이 재생한다. */
  playEffects(effects: readonly AudioEffect[]): readonly string[];
  setOutputLock(lock: OutputLock): void;
  getVoices(): readonly VoiceChain[];
  readonly outputLock: OutputLock;
  /** 종료. 모든 노드와 효과음 source를 정리한다. */
  dispose(): void;
}

export function createAudioGraph(deps: AudioGraphDeps): AudioGraph {
  const voices = new Map<string, VoiceChain>();
  const playedEffects = new Set<string>();
  const activeEffects = new Set<SourceLike>();
  let lock: OutputLock = 'open';
  let disposed = false;

  const applyLock = () => {
    // 잠금은 master gain을 즉시 닫는다.
    deps.environment.masterGain.gainValue = lock === 'open' ? 1 : 0;
  };
  applyLock();

  const teardown = (chain: VoiceChain) => {
    chain.source.stop?.();
    chain.source.disconnect();
    chain.filter.disconnect();
    chain.gain.disconnect();
    chain.panner.disconnect();
  };

  return {
    reconcileVoices(resolved) {
      if (disposed) return;
      const wanted = new Map(resolved.map((voice) => [voice.trackSid, voice]));

      // 정책에서 사라졌거나 세대가 바뀐 voice의 출력을 즉시 닫는다.
      for (const [trackSid, chain] of [...voices.entries()]) {
        const voice = wanted.get(trackSid);
        if (!voice || voice.publisherGeneration !== chain.publisherGeneration) {
          teardown(chain);
          voices.delete(trackSid);
        }
      }

      for (const voice of resolved) {
        const existing = voices.get(voice.trackSid);
        if (existing) {
          // 같은 정책이 두 번 와도 그래프를 다시 만들지 않는다.
          existing.gain.gainValue = voice.gain;
          existing.filter.frequency = voice.lowpassHz;
          existing.panner.azimuthRad = voice.azimuthRad;
          continue;
        }
        const track = deps.getAudioTrack(voice.trackSid);
        // 실제 SDK 트랙이 없으면 출력 0을 유지한다.
        if (!track) continue;
        const source = deps.environment.createSourceFromTrack(track);
        const filter = deps.environment.createFilter();
        const gain = deps.environment.createGain();
        const panner = deps.environment.createPanner();
        filter.frequency = voice.lowpassHz;
        gain.gainValue = voice.gain;
        panner.azimuthRad = voice.azimuthRad;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(panner);
        panner.connect(deps.environment.masterGain);
        source.start?.();
        voices.set(voice.trackSid, {
          trackSid: voice.trackSid,
          playerId: voice.playerId,
          publisherGeneration: voice.publisherGeneration,
          source,
          filter,
          gain,
          panner,
        });
      }
    },

    playEffects(effects) {
      if (disposed) return [];
      const played: string[] = [];
      // 출력이 잠긴 동안에는 조기 효과음을 만들지 않는다.
      if (lock !== 'open') return played;
      for (const effect of effects) {
        // 서버 eventId로 중복을 막는다. 로컬 거리로 새로 판정하지 않는다.
        if (playedEffects.has(effect.eventId)) continue;
        playedEffects.add(effect.eventId);
        const source = deps.environment.createEffectSource(effect.kind);
        const filter = deps.environment.createFilter();
        const gain = deps.environment.createGain();
        const panner = deps.environment.createPanner();
        filter.frequency = effect.lowpassHz;
        gain.gainValue = effect.gain;
        panner.azimuthRad = effect.azimuthRad;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(panner);
        panner.connect(deps.environment.masterGain);
        source.start?.();
        activeEffects.add(source);
        played.push(effect.eventId);
      }
      return played;
    },

    setOutputLock(next) {
      if (next === lock) return;
      lock = next;
      applyLock();
    },

    getVoices: () => [...voices.values()],

    get outputLock() {
      return lock;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const chain of voices.values()) teardown(chain);
      voices.clear();
      for (const source of activeEffects) {
        source.stop?.();
        source.disconnect();
      }
      activeEffects.clear();
      playedEffects.clear();
      deps.environment.masterGain.gainValue = 0;
    },
  };
}
