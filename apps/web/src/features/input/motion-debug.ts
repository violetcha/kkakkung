// 모션 입력 진단 상태. 디버그 오버레이(features/debug)가 읽는 읽기 전용 스냅샷이며 판정에는
// 쓰지 않는다. 오버레이를 없앨 때 이 파일과 InteractionDeps.onMotionDebug 만 같이 지우면 된다.
import type { NeutralReference } from './calibration';
import { headTurnedForMove, type InputTuning } from './input-tuning';
import type { MoveIntent, MovePhase, ReleaseLagStats } from './move-intent';
import { leanComponents, NO_LEAN, relativeLean, type LeanComponents } from './lean-signal';
import type { PoseLandmark } from '../vision/pose-sensor';
import {
  isSampleFresh,
  isUsableQuality,
  type SensorSnapshot,
  type Sample,
  type PoseSensor,
  type FaceSensor,
} from '../vision/sensor-types';

export type MotionDebugState = Readonly<{
  atMs: number;
  /** 현재 세대에 쓸 수 있는 보정이 있는지. 없으면 relative 값은 null 이다. */
  calibrated: boolean;
  neutral: Readonly<{ yawRad: number; shoulderSpan: number; faceSpan: number | null }> | null;
  poseUsable: boolean;
  faceUsable: boolean;
  /** 원시 성분 ln(어깨 x 거리), ln(뺨 사이 거리). */
  components: LeanComponents;
  /** 중립을 뺀 성분(앞이 양수)과 그 평균. 평균이 이동 판정 입력이다. */
  shoulderRelative: number | null;
  faceRelative: number | null;
  leanRelative: number | null;
  /** 사용자 오른쪽이 양수인 yaw(라디안)와 상대값. */
  yawRaw: number | null;
  yawRelative: number | null;
  /** 고개가 회전 해제 임계 이상 돌아가 이동 판정이 막힌 상태. */
  leanGatedByYaw: boolean;
  move: MoveIntent;
  motionActive: boolean;
  /** S15P21C204-281. 한 칸(tap)인지 유지 이동(hold)인지. */
  movePhase: MovePhase;
  /** S15P21C204-280. 해제를 보인 표본부터 의도를 끊기까지 걸린 시간. */
  releaseLag: ReleaseLagStats;
  turnLatched: boolean;
  mode: 'motion' | 'keyboard' | null;
  /** 이 스냅샷이 실제로 이동/회전 판정에 들어갔는지(문맥·모드·폴백 조건). */
  accepting: boolean;
  thresholds: Readonly<{
    forwardEnter: number;
    forwardExit: number;
    backEnter: number;
    backExit: number;
    turnEnter: number;
    turnExit: number;
  }>;
}>;

export function describeMotionDebug(input: {
  snapshot: SensorSnapshot;
  nowMs: number;
  neutral: NeutralReference | null;
  neutralUsable: boolean;
  tuning: InputTuning;
  move: MoveIntent;
  motionActive: boolean;
  movePhase: MovePhase;
  releaseLag: ReleaseLagStats;
  turnLatched: boolean;
  mode: 'motion' | 'keyboard' | null;
  accepting: boolean;
}): MotionDebugState {
  const { snapshot, nowMs, tuning } = input;
  const pose = snapshot.pose;
  const poseUsable =
    isSampleFresh(pose, 'pose', nowMs) &&
    pose!.status === 'valid' &&
    isUsableQuality(pose!.data.quality);
  const face = snapshot.face;
  const faceUsable =
    isSampleFresh(face, 'face', nowMs) &&
    face!.status === 'valid' &&
    isUsableQuality(face!.data.quality);
  const poseLandmarks = poseUsable
    ? ((pose as Sample<PoseSensor> & { status: 'valid' }).data.landmarks as readonly PoseLandmark[])
    : null;
  const faceData = faceUsable ? (face as Sample<FaceSensor> & { status: 'valid' }).data : null;
  const components =
    poseLandmarks || faceData
      ? leanComponents(poseLandmarks, faceData?.landmarks ?? null)
      : NO_LEAN;
  const yawRaw = faceData ? faceData.yawRad : null;
  const neutral = input.neutralUsable && input.neutral ? input.neutral : null;
  const yawRelative = neutral && yawRaw !== null ? yawRaw - neutral.yawRad : null;
  const relative = neutral
    ? relativeLean(components, { shoulderSpan: neutral.shoulderSpan, faceSpan: neutral.faceSpan })
    : { combined: null, shoulder: null, face: null };
  return {
    atMs: nowMs,
    calibrated: neutral !== null,
    neutral: neutral
      ? { yawRad: neutral.yawRad, shoulderSpan: neutral.shoulderSpan, faceSpan: neutral.faceSpan }
      : null,
    poseUsable,
    faceUsable,
    components,
    shoulderRelative: relative.shoulder,
    faceRelative: relative.face,
    leanRelative: relative.combined,
    yawRaw,
    yawRelative,
    leanGatedByYaw: headTurnedForMove(yawRelative, tuning),
    move: input.move,
    motionActive: input.motionActive,
    movePhase: input.movePhase,
    releaseLag: input.releaseLag,
    turnLatched: input.turnLatched,
    mode: input.mode,
    accepting: input.accepting,
    thresholds: {
      forwardEnter: tuning.forwardEnterRad,
      forwardExit: tuning.forwardExitRad,
      backEnter: tuning.backEnterRad,
      backExit: tuning.backExitRad,
      turnEnter: tuning.turnEnterRad,
      turnExit: tuning.turnExitRad,
    },
  };
}
