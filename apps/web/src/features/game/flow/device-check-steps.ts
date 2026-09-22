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
 * S15P21C204-330. 통과한 단계를 기억한다.
 * 점검이 묻는 것은 "지금 추적 중인가"가 아니라 "이 묶음을 통과한 적 있는가"다. 얼굴이 잠깐
 * 벗어나 vision 이 loading 으로 떨어지는 일은 정상이고 — 4단계 단추를 누르려고 화면 아래를
 * 보면 그렇게 된다 — 그때마다 통과가 취소되면 화면이 1단계로 되돌아간다.
 *
 * 같은 `steps` 로 두 번 불러도 결과가 같아, 렌더 중에 불러도 안전하다.
 */
export function passedDeviceCheckSteps(
  previous: ReadonlySet<DeviceCheckStepId>,
  steps: readonly DeviceCheckStep[],
): ReadonlySet<DeviceCheckStepId> {
  const next = new Set(previous);
  for (const step of steps) {
    if (step.state === 'done') next.add(step.id);
    // blocked 는 순간 잡음이 아니라 실패다. 기억을 지우고 그 단계로 돌려보낸다.
    if (step.state === 'blocked') next.delete(step.id);
  }
  // 한 단계라도 막혀 있으면 '완료'는 통과로 두지 않는다. 준비 완료가 열려서는 안 된다.
  if (steps.some((step) => step.state === 'blocked')) next.delete('done');
  return next;
}

/**
 * 기억한 통과를 입힌 단계들. 진행(어느 단계를 볼지)과 준비 완료 개방만 이걸로 정하고,
 * 점에는 살아 있는 상태를 그대로 그린다 — 되돌아간 것은 알리되 진행을 되감지는 않는다.
 * blocked 는 어떤 기억보다 우선한다.
 */
export function latchDeviceCheckSteps(
  steps: readonly DeviceCheckStep[],
  passed: ReadonlySet<DeviceCheckStepId>,
): readonly DeviceCheckStep[] {
  return steps.map((step) =>
    step.state === 'done' || step.state === 'blocked' || !passed.has(step.id)
      ? step
      : Object.freeze({ ...step, state: 'done' as const }),
  );
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
