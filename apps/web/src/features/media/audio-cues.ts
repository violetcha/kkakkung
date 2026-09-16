import { unitGain } from './audio-preferences';
import { createCueBuffer, type CueKind } from './cue-buffer';

export type CueResult = 'played' | 'unavailable' | 'muted';

/**
 * S15P21C204-261. 자기 상태 안내음 재생기. 확인음(audio-diagnostics)과 같이 장치 점검에서 사용자
 * 제스처로 연 Context를 쓰고 destination에 직접 연결한다. 출력 잠금(master gain)은 서버 승인
 * 소리에만 적용되므로 여기에는 걸리지 않는다. 음소거·음량은 호출 측(runtime)이 먼저 판단한다.
 */
export interface AudioCues {
  play(kind: CueKind, volume: number): boolean;
  /** 재생 중인 안내음 수. 정리 검증용. */
  readonly activeCount: number;
  dispose(): void;
}

/** 안내음은 음성·효과음보다 조금 작게 낸다. */
const CUE_LEVEL = 0.35;

export function createAudioCues(
  context: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer' | 'createBufferSource'> &
    Pick<AudioContext, 'createGain' | 'destination' | 'state'>,
): AudioCues {
  let disposed = false;
  const buffers = new Map<CueKind, AudioBuffer>();
  const active = new Map<AudioBufferSourceNode, () => void>();
  return {
    play(kind, volume) {
      const level = unitGain(volume) * CUE_LEVEL;
      if (disposed || context.state !== 'running' || level === 0) return false;
      let buffer = buffers.get(kind);
      if (!buffer) {
        buffer = createCueBuffer(context, kind);
        buffers.set(kind, buffer);
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = level;
      source.connect(gain);
      gain.connect(context.destination);
      const cleanup = () => {
        if (!active.delete(source)) return;
        source.onended = null;
        source.disconnect();
        gain.disconnect();
      };
      active.set(source, cleanup);
      source.onended = cleanup;
      try {
        source.start();
      } catch {
        cleanup();
        return false;
      }
      return true;
    },
    get activeCount() {
      return active.size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [source, cleanup] of [...active]) {
        try {
          source.stop();
        } catch {
          /* Already ended. */
        }
        cleanup();
      }
      buffers.clear();
    },
  };
}
