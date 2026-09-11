// D-12 / IN-10. 카메라·추론 장애의 입력 폴백.
// 장애는 보조 입력 전환이며 게임 참가·Room·미디어 세대를 종료하지 않는다.
import { isSampleFresh, isUsableQuality, type SensorSnapshot } from '../vision/sensor-types';
import type { InputMode } from './interaction-context';

export type InputFailureCode =
  'CAMERA_ENDED' | 'WORKER_ERROR' | 'INFERENCE_STALLED' | 'FACE_INVALID';

/** 이 시간 동안 새 추론 결과가 없으면 미응답으로 본다. 명시적 초깃값이다. */
export const INFERENCE_STALL_MS = 1500;
/** 얼굴이 이만큼 계속 무효하면 모션 입력을 신뢰하지 않는다. */
export const FACE_INVALID_MS = 1500;

export type InputFallbackDeps = Readonly<{
  /** 이동 timer·회전 latch·gesture hold·모션 버퍼를 비운다. */
  clearHolds(): void;
  /** 모드가 실제로 바뀔 때만 부른다. */
  onModeChange(mode: InputMode): void;
  /** 장치·비전 문제를 상태로 보고한다. 참가를 끝내지 않는다. */
  onFailure(code: InputFailureCode): void;
  stallMs?: number;
  faceInvalidMs?: number;
}>;

export interface InputFallback {
  /** 센서 발행마다 호출한다. 장애를 감지하면 code를 돌려준다. */
  observe(
    snapshot: SensorSnapshot | null,
    nowMs: number,
    runtimeGeneration: number,
  ): InputFailureCode | null;
  /** 카메라 종료·Worker 오류처럼 즉시 아는 장애. */
  report(code: InputFailureCode): void;
  /** 마이크만 실패한 경우. 모션을 유지하고 송신만 멈춘다. */
  reportMicrophoneOnly(): void;
  /** 새 보정과 명시적 mode 선택이 끝났을 때만 모션을 다시 켠다. */
  restoreMotion(input: { calibrated: boolean; requestedMode: InputMode }): boolean;
  /** 새 라운드·세대 시작. */
  reset(): void;
  readonly mode: InputMode;
  readonly degraded: boolean;
  readonly lastFailure: InputFailureCode | null;
}

export function createInputFallback(deps: InputFallbackDeps): InputFallback {
  const stallMs = deps.stallMs ?? INFERENCE_STALL_MS;
  const faceInvalidMs = deps.faceInvalidMs ?? FACE_INVALID_MS;
  let mode: InputMode = 'motion';
  let degraded = false;
  let lastFailure: InputFailureCode | null = null;
  let lastResultAtMs: number | null = null;
  let lastValidFaceAtMs: number | null = null;
  let lastFrameId: number | null = null;

  const degrade = (code: InputFailureCode) => {
    const changed = lastFailure !== code;
    lastFailure = code;
    if (degraded && mode === 'keyboard') {
      if (changed) deps.onFailure(code);
      return;
    }
    // 장애 직전 held를 남기지 않는다. 새 키누름부터 다시 받는다.
    deps.clearHolds();
    deps.onFailure(code);
    degraded = true;
    if (mode !== 'keyboard') {
      mode = 'keyboard';
      deps.onModeChange(mode);
    }
  };

  return {
    observe(snapshot, nowMs, runtimeGeneration) {
      if (!snapshot || snapshot.runtimeGeneration !== runtimeGeneration) {
        if (lastResultAtMs !== null && nowMs - lastResultAtMs > stallMs) {
          degrade('INFERENCE_STALLED');
          return 'INFERENCE_STALLED';
        }
        return null;
      }
      const face = snapshot.face;
      const newResult = face !== null && face.frameId !== lastFrameId;
      if (newResult) {
        lastFrameId = face.frameId;
        lastResultAtMs = nowMs;
      }
      if (lastResultAtMs === null) lastResultAtMs = nowMs;

      const faceUsable =
        isSampleFresh(face, 'face', nowMs) &&
        face!.status === 'valid' &&
        isUsableQuality(face!.data.quality);
      if (faceUsable) lastValidFaceAtMs = nowMs;
      else lastValidFaceAtMs ??= nowMs;

      if (nowMs - lastResultAtMs > stallMs) {
        degrade('INFERENCE_STALLED');
        return 'INFERENCE_STALLED';
      }
      if (!faceUsable && nowMs - lastValidFaceAtMs > faceInvalidMs) {
        degrade('FACE_INVALID');
        return 'FACE_INVALID';
      }
      return null;
    },

    report(code) {
      degrade(code);
    },

    reportMicrophoneOnly() {
      // 마이크만 장애면 모션을 유지한다. 송신 중단은 게시 경로가 처리한다.
    },

    restoreMotion(input) {
      // 복구 뒤에도 새 보정과 명시적 mode 선택이 있어야 모션을 다시 켠다.
      if (!degraded) return mode === 'motion';
      if (!input.calibrated || input.requestedMode !== 'motion') return false;
      degraded = false;
      lastFailure = null;
      lastResultAtMs = null;
      lastValidFaceAtMs = null;
      lastFrameId = null;
      mode = 'motion';
      deps.onModeChange(mode);
      return true;
    },

    reset() {
      mode = 'motion';
      degraded = false;
      lastFailure = null;
      lastResultAtMs = null;
      lastValidFaceAtMs = null;
      lastFrameId = null;
    },

    get mode() {
      return mode;
    },
    get degraded() {
      return degraded;
    },
    get lastFailure() {
      return lastFailure;
    },
  };
}
