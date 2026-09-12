// D-06 / IN-06. 사용자 중립 보정.
// 신선한 서로 다른 face/pose Sample만 모아 중립 yaw/lean 기준을 정한다.
// 표본이 부족하면 미보정으로 남기고 이전 사용자·장치의 기준을 재사용하지 않는다.
import { torsoLeanRad, type PoseLandmark } from '../vision/pose-sensor';
import {
  isSampleFresh,
  isUsableQuality,
  type SensorSnapshot,
  type Sample,
  type FaceSensor,
  type PoseSensor,
} from '../vision/sensor-types';
import { INPUT_TUNING, type InputTuning } from './input-tuning';

export type NeutralReference = Readonly<{
  yawRad: number;
  leanRad: number;
  tuningVersion: string;
  /** 이 보정을 만든 장치 세대. 세대가 바뀌면 재사용하지 않는다. */
  runtimeGeneration: number;
  sampleCount: number;
}>;

export type CalibrationState = 'idle' | 'running' | 'ready' | 'failed';

export type CalibrationFailure =
  | 'CALIBRATION_NOT_ENOUGH_SAMPLES'
  | 'CALIBRATION_UNSTABLE'
  | 'CALIBRATION_NO_FACE'
  | 'CALIBRATION_NO_POSE';

export type CalibrationResult =
  | Readonly<{ state: 'ready'; neutral: NeutralReference; errorCode: null }>
  | Readonly<{ state: 'failed'; neutral: null; errorCode: CalibrationFailure }>;

type Observation = Readonly<{
  frameId: number;
  poseFrameId: number;
  yawRad: number;
  leanRad: number;
}>;

export interface Calibrator {
  begin(runtimeGeneration: number): void;
  /** 신선하고 새로운 표본만 받는다. 받아들였으면 true다. */
  observe(snapshot: SensorSnapshot, nowMs: number): boolean;
  finish(): CalibrationResult;
  /** 새 match·장치 변경·실패에서 보정을 버린다. */
  reset(): void;
  readonly state: CalibrationState;
  readonly sampleCount: number;
  getNeutral(): NeutralReference | null;
}

function spread(values: readonly number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(...values) - Math.min(...values);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function usableFace(sample: SensorSnapshot['face'], nowMs: number): FaceSensor | null {
  if (!isSampleFresh(sample, 'face', nowMs)) return null;
  const valid = sample as Sample<FaceSensor> & { status: 'valid' };
  return isUsableQuality(valid.data.quality) ? valid.data : null;
}

function usablePose(sample: SensorSnapshot['pose'], nowMs: number): PoseSensor | null {
  if (!isSampleFresh(sample, 'pose', nowMs)) return null;
  const valid = sample as Sample<PoseSensor> & { status: 'valid' };
  return isUsableQuality(valid.data.quality) ? valid.data : null;
}

export function createCalibrator(tuning: InputTuning = INPUT_TUNING): Calibrator {
  let state: CalibrationState = 'idle';
  let generation = -1;
  let observations: Observation[] = [];
  let neutral: NeutralReference | null = null;
  let sawFace = false;
  let sawPose = false;

  const clear = () => {
    observations = [];
    sawFace = false;
    sawPose = false;
  };

  return {
    begin(runtimeGeneration) {
      // 세대가 바뀌면 이전 기준을 절대 재사용하지 않는다.
      neutral = null;
      generation = runtimeGeneration;
      state = 'running';
      clear();
    },

    observe(snapshot, nowMs) {
      if (state !== 'running') return false;
      if (snapshot.runtimeGeneration !== generation) return false;
      const face = usableFace(snapshot.face, nowMs);
      const pose = usablePose(snapshot.pose, nowMs);
      if (face) sawFace = true;
      if (pose) sawPose = true;
      if (!face || !pose) return false;
      const frameId = snapshot.face!.frameId;
      const poseFrameId = snapshot.pose!.frameId;
      // 같은 프레임을 다시 세지 않는다.
      if (observations.some((item) => item.frameId === frameId || item.poseFrameId === poseFrameId))
        return false;
      const lean = torsoLeanRad(pose.landmarks as readonly PoseLandmark[]);
      if (lean === null || !Number.isFinite(face.yawRad)) return false;
      observations.push({ frameId, poseFrameId, yawRad: face.yawRad, leanRad: lean });
      return true;
    },

    finish() {
      if (observations.length < tuning.calibrationMinSamples) {
        state = 'failed';
        const errorCode: CalibrationFailure = !sawFace
          ? 'CALIBRATION_NO_FACE'
          : !sawPose
            ? 'CALIBRATION_NO_POSE'
            : 'CALIBRATION_NOT_ENOUGH_SAMPLES';
        neutral = null;
        clear();
        return { state: 'failed', neutral: null, errorCode };
      }
      const yaws = observations.map((item) => item.yawRad);
      const leans = observations.map((item) => item.leanRad);
      if (
        spread(yaws) > tuning.calibrationMaxSpreadRad ||
        spread(leans) > tuning.calibrationMaxSpreadRad
      ) {
        state = 'failed';
        neutral = null;
        clear();
        return { state: 'failed', neutral: null, errorCode: 'CALIBRATION_UNSTABLE' };
      }
      neutral = {
        yawRad: median(yaws),
        leanRad: median(leans),
        tuningVersion: tuning.tuningVersion,
        runtimeGeneration: generation,
        sampleCount: observations.length,
      };
      state = 'ready';
      clear();
      return { state: 'ready', neutral, errorCode: null };
    },

    reset() {
      state = 'idle';
      neutral = null;
      generation = -1;
      clear();
    },

    get state() {
      return state;
    },
    get sampleCount() {
      return observations.length;
    },
    getNeutral: () => neutral,
  };
}

/** 보정 기준이 현재 세대에 쓸 수 있는지 확인한다. */
export function isNeutralUsable(
  neutral: NeutralReference | null,
  runtimeGeneration: number,
  tuning: InputTuning = INPUT_TUNING,
): neutral is NeutralReference {
  if (!neutral) return false;
  return (
    neutral.runtimeGeneration === runtimeGeneration &&
    neutral.tuningVersion === tuning.tuningVersion
  );
}

/** 보정된 중립을 뺀 상대 각도. 보정 전에는 null이며 행동을 발동하지 않는다. */
export function relativeToNeutral(value: number, neutralValue: number | undefined): number | null {
  if (neutralValue === undefined || !Number.isFinite(value)) return null;
  return value - neutralValue;
}
