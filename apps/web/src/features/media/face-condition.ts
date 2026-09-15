// S15P21C204-244. 얼굴 조건별 원인 구분과 안내.
// D-08 안전 프레임 전환은 "왜" 를 말하지 않는다. 여기서 안경 반사·역광·큰 회전·가림을
// 서로 다른 조치 문구로 나눈다. 가공 얼굴을 익명화라고 안내하지 않는다.
import { FACE_MAX_YAW_RAD } from '../vision/face-sensor';
import type { NormalizedLandmark } from '../vision/sensor-types';
import { FACE_OVAL_INDICES } from './face-mask';

/**
 * 기획서 확정 상수가 아니다. 명시적 초깃값이며 대표 장치 검증 후 조정한다.
 * 조정하면 이 버전을 올리고 safe-face.SAFE_FACE_TUNING_VERSION 과 같은 방식으로 기록한다.
 */
export const FACE_CONDITION_TUNING_VERSION = 'D-face-condition-1';

export type FaceCondition =
  /** 네 조건 중 어느 것도 아니다. 안내하지 않는다. */
  | 'ok'
  /** 큰 회전. yaw 가 가공 한계를 넘었다. */
  | 'turned-away'
  /** 안경 반사. 눈 영역에 포화 픽셀이 몰렸다. */
  | 'glare'
  /** 역광. 얼굴이 어둡고 주변이 그보다 훨씬 밝다. */
  | 'backlit'
  /** 가림. 얼굴 외곽 점을 충분히 읽지 못했다. */
  | 'occluded'
  /** 판정 근거가 부족하다. 안내하지 않는다. */
  | 'unknown';

/**
 * 가공 Canvas 한 장에서 뽑은 휘도 표본. 원본 프레임을 저장하지 않고 통계만 남긴다.
 * 표본 추출은 face-luminance 가 하고 여기서는 판정만 한다.
 */
export type LuminanceProfile = Readonly<{
  /** 마스크 안쪽 평균 휘도 0~255. */
  faceMean: number;
  /** 마스크 바깥(crop 테두리) 평균 휘도 0~255. */
  surroundMean: number;
  /** 눈 영역에서 포화된 픽셀 비율 0~1. */
  eyeSaturatedRatio: number;
  /** 실제로 읽은 픽셀 수. 너무 적으면 판정하지 않는다. */
  sampleCount: number;
}>;

export type FaceConditionInput = Readonly<{
  /** 신선한 유효 얼굴 표본이 없으면 true. */
  faceMissing: boolean;
  /** 사용자 기준 yaw. 표본이 없으면 null. */
  yawRad: number | null;
  /** 읽지 못한 얼굴 외곽 점의 비율 0~1. */
  ovalMissingRatio: number;
  /** 표본을 못 뽑았으면 null. */
  luminance: LuminanceProfile | null;
}>;

/** 이 비율을 넘게 외곽 점을 잃으면 가림으로 본다. */
export const OCCLUSION_MISSING_RATIO = 0.15;
/** 이보다 어두운 얼굴은 노출이 모자란 것으로 본다. */
export const BACKLIT_FACE_MAX_LUMA = 70;
/** 주변이 얼굴보다 이 배 이상 밝으면 역광으로 본다. */
export const BACKLIT_SURROUND_RATIO = 1.8;
/** 이 값 이상을 포화로 센다. */
export const GLARE_SATURATION_LUMA = 245;
/** 눈 영역 포화가 이 비율을 넘으면 안경 반사로 본다. */
export const GLARE_EYE_RATIO = 0.08;
/** 표본이 이보다 적으면 휘도 판정을 하지 않는다. */
export const LUMINANCE_MIN_SAMPLES = 64;

/**
 * 읽지 못한 얼굴 외곽 점의 비율. buildFaceMask 는 한 점만 없어도 null 을 돌려주므로
 * "얼마나" 잃었는지는 여기서 따로 센다. 손·머리카락에 가리면 그 구간 점들이 함께 사라진다.
 */
export function ovalMissingRatio(landmarks: readonly NormalizedLandmark[]): number {
  let missing = 0;
  for (const index of FACE_OVAL_INDICES) {
    const point = landmarks[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) missing += 1;
  }
  return missing / FACE_OVAL_INDICES.length;
}

function hasUsableLuminance(value: LuminanceProfile | null): value is LuminanceProfile {
  return (
    value !== null &&
    value.sampleCount >= LUMINANCE_MIN_SAMPLES &&
    Number.isFinite(value.faceMean) &&
    Number.isFinite(value.surroundMean) &&
    Number.isFinite(value.eyeSaturatedRatio)
  );
}

function isGlare(value: LuminanceProfile): boolean {
  return value.eyeSaturatedRatio >= GLARE_EYE_RATIO;
}

function isBacklit(value: LuminanceProfile): boolean {
  // 얼굴이 어두운 것만으로는 역광이 아니다. 주변이 그보다 밝아야 조치가 성립한다.
  if (value.faceMean > BACKLIT_FACE_MAX_LUMA) return false;
  return value.surroundMean >= Math.max(value.faceMean, 1) * BACKLIT_SURROUND_RATIO;
}

/**
 * 한 프레임의 조건을 정한다. 순서가 곧 우선순위다.
 *
 * 큰 회전은 yaw 하나로 확정되므로 먼저 본다. 역광은 가림보다 앞에 둔다. 강한 역광은 외곽 점을
 * 함께 잃게 만들어 가림처럼 보이는데, 이때 사용자에게 유효한 조치는 "가린 것을 치우세요" 가
 * 아니라 "조명을 등지지 마세요" 이기 때문이다.
 */
export function classifyFaceCondition(input: FaceConditionInput): FaceCondition {
  const luminance = hasUsableLuminance(input.luminance) ? input.luminance : null;

  if (input.yawRad !== null && Math.abs(input.yawRad) > FACE_MAX_YAW_RAD) return 'turned-away';
  if (luminance && isGlare(luminance)) return 'glare';
  if (luminance && isBacklit(luminance)) return 'backlit';
  if (input.ovalMissingRatio > OCCLUSION_MISSING_RATIO) return 'occluded';
  // 얼굴을 통째로 잃었는데 휘도로도 설명되지 않으면 가림으로 단정하지 않는다.
  if (input.faceMissing) return luminance ? 'occluded' : 'unknown';
  return 'ok';
}

/**
 * 조치 가능한 안내 문구. 원인과 사용자가 할 일을 한 문장에 담는다.
 * 가공 얼굴의 처리 방식을 설명하는 자리가 아니다.
 */
export const FACE_CONDITION_GUIDANCE: Readonly<Record<FaceCondition, string | null>> =
  Object.freeze({
    ok: null,
    unknown: null,
    'turned-away': '고개를 화면 쪽으로 돌려 주세요.',
    glare: '안경에 조명이 반사되고 있어요. 고개나 조명 각도를 조금 바꿔 주세요.',
    backlit: '뒤쪽이 더 밝아요. 창이나 조명을 등지지 말고 얼굴 앞쪽을 밝혀 주세요.',
    occluded: '얼굴이 가려졌어요. 손이나 머리카락으로 가린 곳을 치워 주세요.',
  });

export function faceConditionGuidance(condition: FaceCondition): string | null {
  return FACE_CONDITION_GUIDANCE[condition];
}

/** 이만큼 같은 조건이 이어져야 안내를 띄운다. 한두 프레임의 흔들림은 무시한다. */
export const CONDITION_SHOW_AFTER_MS = 800;
/** 한 번 띄운 안내는 조건이 풀려도 이만큼은 남긴다. 깜빡임을 막는다. */
export const CONDITION_MIN_VISIBLE_MS = 2000;
/** 같은 조건을 이 간격 안에 다시 띄우지 않는다. 중복 표시 억제 기준이다. */
export const CONDITION_REPEAT_SUPPRESS_MS = 10000;

export type FaceConditionNotice = Readonly<{
  condition: FaceCondition;
  message: string;
  /** 이번 호출에서 새로 뜬 안내인지. 같은 안내가 이어지는 동안에는 false 다. */
  isNew: boolean;
}>;

export interface FaceConditionNotifier {
  /** 프레임마다 부른다. 지금 보여 줄 안내가 없으면 null 이다. */
  observe(condition: FaceCondition, nowMs: number): FaceConditionNotice | null;
  reset(): void;
}

/**
 * 표시·해제와 중복 억제를 한곳에서 정한다.
 *
 * - 표시: 같은 조건이 CONDITION_SHOW_AFTER_MS 이어질 때.
 * - 해제: 조건이 풀리고 CONDITION_MIN_VISIBLE_MS 가 지난 뒤.
 * - 억제: 같은 조건을 마지막으로 내린 지 CONDITION_REPEAT_SUPPRESS_MS 안이면 다시 띄우지 않는다.
 *
 * 다른 조건으로 바뀌면 억제를 적용하지 않는다. 사용자가 한 문제를 고치고 다음 문제를 만난
 * 경우이므로 바로 알려 주는 편이 맞다.
 */
export function createFaceConditionNotifier(): FaceConditionNotifier {
  let candidate: FaceCondition = 'ok';
  let candidateSinceMs = 0;
  let shown: FaceCondition | null = null;
  let shownAtMs = 0;
  const lastClearedAtMs = new Map<FaceCondition, number>();

  const clear = (nowMs: number) => {
    if (shown !== null) lastClearedAtMs.set(shown, nowMs);
    shown = null;
  };

  return {
    observe(condition, nowMs) {
      if (condition !== candidate) {
        candidate = condition;
        candidateSinceMs = nowMs;
      }

      if (shown !== null) {
        // 같은 조건이 이어지는 동안에는 그대로 둔다.
        if (condition === shown)
          return { condition: shown, message: messageOf(shown), isNew: false };
        if (nowMs - shownAtMs < CONDITION_MIN_VISIBLE_MS)
          return { condition: shown, message: messageOf(shown), isNew: false };
        clear(nowMs);
      }

      if (faceConditionGuidance(condition) === null) return null;
      if (nowMs - candidateSinceMs < CONDITION_SHOW_AFTER_MS) return null;

      const clearedAt = lastClearedAtMs.get(condition);
      if (clearedAt !== undefined && nowMs - clearedAt < CONDITION_REPEAT_SUPPRESS_MS) return null;

      shown = condition;
      shownAtMs = nowMs;
      return { condition, message: messageOf(condition), isNew: true };
    },

    reset() {
      candidate = 'ok';
      candidateSinceMs = 0;
      shown = null;
      shownAtMs = 0;
      lastClearedAtMs.clear();
    },
  };
}

function messageOf(condition: FaceCondition): string {
  // 안내가 있는 조건만 표시 상태로 올라오므로 여기서 null 은 나오지 않는다.
  return faceConditionGuidance(condition) ?? '';
}
