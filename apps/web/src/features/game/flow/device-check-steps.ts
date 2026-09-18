// S15P21C204-273. 장치 점검 네 단계. DeviceStatus 다섯 값을 단계별로 나눠 읽기만 한다.
// 상태를 만들지 않고 읽어서 분류만 하므로 서버·입력 판정과 겹치지 않는다.
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { deviceReady } from './device-readiness';
import { motionCheckDone, type MotionCheck } from './motion-check';

export type DeviceCheckStepId = 'camera' | 'posture' | 'sound' | 'done';

/** waiting: 아직 안 함 · busy: 진행 중 · blocked: 여기서 막힘 · done: 통과 */
export type DeviceCheckStepState = 'waiting' | 'busy' | 'blocked' | 'done';

export type DeviceCheckStep = Readonly<{
  id: DeviceCheckStepId;
  index: number;
  label: string;
  state: DeviceCheckStepState;
}>;

export const DEVICE_CHECK_STEP_LABELS: Readonly<Record<DeviceCheckStepId, string>> = Object.freeze({
  camera: '카메라',
  posture: '자세',
  sound: '소리',
  done: '완료',
});

function cameraState(status: DeviceStatus): DeviceCheckStepState {
  if (status.camera === 'failed' || status.vision === 'failed') return 'blocked';
  if (status.camera === 'ready' && status.vision === 'ready') return 'done';
  if (status.camera === 'requesting' || status.vision === 'loading') return 'busy';
  return 'waiting';
}

/**
 * 보정이 끝나도 기울이기·고개 돌리기를 한 번씩 보기 전에는 busy로 둔다.
 * 신호가 없는 화면(검수·키보드 조작)에서는 motion 을 넘기지 않아 보정만으로 끝난다.
 */
function postureState(status: DeviceStatus, motion: MotionCheck | null): DeviceCheckStepState {
  if (status.calibration === 'failed') return 'blocked';
  if (status.calibration === 'running') return 'busy';
  if (status.calibration === 'ready') return motionCheckDone(motion) ? 'done' : 'busy';
  return 'waiting';
}

/** 마이크는 선택이라 거부·실패해도 단계를 막지 않는다. */
function soundState(status: DeviceStatus): DeviceCheckStepState {
  if (status.audioPlayback === 'failed') return 'blocked';
  if (status.audioPlayback === 'ready') return 'done';
  return 'waiting';
}

export function deviceCheckSteps(input: {
  status: DeviceStatus;
  motion?: MotionCheck | null;
}): readonly DeviceCheckStep[] {
  const { status } = input;
  const states: Record<DeviceCheckStepId, DeviceCheckStepState> = {
    camera: cameraState(status),
    posture: postureState(status, input.motion ?? null),
    sound: soundState(status),
    done: deviceReady(status) ? 'done' : 'waiting',
  };
  return (['camera', 'posture', 'sound', 'done'] as const).map((id, index) =>
    Object.freeze({ id, index, label: DEVICE_CHECK_STEP_LABELS[id], state: states[id] }),
  );
}

/** 범위를 벗어난 지표를 첫·끝 단계로 접어 준다. 화면이 빈 단계를 그리지 않게 한다. */
export function deviceCheckStepAt(
  steps: readonly DeviceCheckStep[],
  index: number,
): DeviceCheckStep {
  const clamped = Math.min(Math.max(index, 0), steps.length - 1);
  return (
    steps[clamped] ?? {
      id: 'camera',
      index: 0,
      label: DEVICE_CHECK_STEP_LABELS.camera,
      state: 'waiting',
    }
  );
}

/** 지금 봐야 할 단계. 다 끝났으면 마지막(완료) 단계다. */
export function activeDeviceCheckStep(steps: readonly DeviceCheckStep[]): number {
  const pending = steps.findIndex((step) => step.state !== 'done');
  return pending === -1 ? steps.length - 1 : pending;
}

/**
 * 오류 code 를 낸 단계. 문구가 다른 단계로 새지 않게 여기서 한 번만 정한다.
 * 분류를 모르는 code 는 첫 단계로 보내 점검을 처음부터 다시 하게 한다.
 */
export function deviceCheckErrorStep(code: string): DeviceCheckStepId {
  if (code.startsWith('CALIBRATION_')) return 'posture';
  if (code.startsWith('MICROPHONE_') || code.startsWith('AUDIO_')) return 'sound';
  return 'camera';
}
