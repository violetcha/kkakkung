// D-08 / ME-02. 얼굴 추적 실패의 안전 프레임 전환.
// 마지막 안전 Canvas 프레임을 잠시 유지한 뒤 코드로 만든 기본 얼굴로 바꾼다.
// 무기한 마지막 실사 얼굴 유지와 raw 영상 fallback은 금지한다.
import { isSampleFresh, isUsableQuality, type SensorSnapshot } from '../vision/sensor-types';
import { PROCESSED_FACE_SIZE } from './face-mask';

/**
 * 기획서 확정 상수가 아니다. 명시적 초깃값이며 대표 장치 검증 후 조정한다.
 * 이 값을 넘기면 마지막 실사 프레임을 버리고 기본 얼굴로 내려간다.
 */
export const SAFE_FACE_HOLD_MS = 1200;
export const SAFE_FACE_TUNING_VERSION = 'D-safe-face-1';

export type SafeFaceMode =
  /** 새 유효 얼굴을 그린다. */
  | 'live'
  /** 마지막 안전 프레임을 그대로 둔다. */
  | 'hold'
  /** 코드로 만든 기본 얼굴을 그린다. */
  | 'default';

export type SafeFaceDecision = Readonly<{
  mode: SafeFaceMode;
  /** 이 결정이 근거로 삼은 얼굴 표본의 frameId. 없으면 null이다. */
  frameId: number | null;
}>;

export interface SafeFacePolicy {
  /** 현재 스냅샷으로 그릴 내용을 정한다. */
  decide(
    snapshot: SensorSnapshot | null,
    nowMs: number,
    runtimeGeneration: number,
  ): SafeFaceDecision;
  reset(): void;
  readonly mode: SafeFaceMode;
}

export function createSafeFacePolicy(holdMs: number = SAFE_FACE_HOLD_MS): SafeFacePolicy {
  let lastUsableAtMs: number | null = null;
  let lastFrameId: number | null = null;
  let mode: SafeFaceMode = 'default';

  return {
    decide(snapshot, nowMs, runtimeGeneration) {
      // 구 세대 결과는 기본 얼굴을 덮지 못한다.
      if (!snapshot || snapshot.runtimeGeneration !== runtimeGeneration) {
        mode = lastUsableAtMs !== null && nowMs - lastUsableAtMs <= holdMs ? 'hold' : 'default';
        if (mode === 'default') lastUsableAtMs = null;
        return { mode, frameId: null };
      }
      const face = snapshot.face;
      const fresh = isSampleFresh(face, 'face', nowMs);
      const usable = fresh && face!.status === 'valid' && isUsableQuality(face!.data.quality);
      if (usable) {
        // 같은 frameId를 새 검출로 다시 세지 않는다.
        const frameId = face!.frameId;
        const isNew = frameId !== lastFrameId;
        lastFrameId = frameId;
        lastUsableAtMs = nowMs;
        mode = 'live';
        return { mode, frameId: isNew ? frameId : null };
      }
      if (lastUsableAtMs !== null && nowMs - lastUsableAtMs <= holdMs) {
        mode = 'hold';
        return { mode, frameId: null };
      }
      mode = 'default';
      lastUsableAtMs = null;
      return { mode, frameId: null };
    },

    reset() {
      lastUsableAtMs = null;
      lastFrameId = null;
      mode = 'default';
    },

    get mode() {
      return mode;
    },
  };
}

export type DefaultFaceShape = Readonly<{
  /** 캔버스 픽셀 좌표. 코드로만 만든 기본 얼굴이며 실사 픽셀이 아니다. */
  head: Readonly<{ x: number; y: number; radius: number }>;
  eyes: readonly Readonly<{ x: number; y: number; radius: number }>[];
  mouth: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

/** 기본 얼굴 도형. 원본 프레임을 전혀 쓰지 않는다. */
export function defaultFaceShape(size: number = PROCESSED_FACE_SIZE): DefaultFaceShape {
  const center = size / 2;
  return {
    head: { x: center, y: center, radius: size * 0.32 },
    eyes: [
      { x: center - size * 0.12, y: center - size * 0.08, radius: size * 0.035 },
      { x: center + size * 0.12, y: center - size * 0.08, radius: size * 0.035 },
    ],
    mouth: { x: center, y: center + size * 0.13, width: size * 0.2, height: size * 0.035 },
  };
}
