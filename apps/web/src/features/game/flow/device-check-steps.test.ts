import { describe, expect, it } from 'vitest';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { INITIAL_DEVICES } from './device-readiness';
import {
  activeDeviceCheckStep,
  deviceCheckErrorStep,
  deviceCheckStepAt,
  deviceCheckSteps,
  latchDeviceCheckSteps,
  passedDeviceCheckSteps,
  type DeviceCheckStepId,
} from './device-check-steps';

const at = (status: DeviceStatus, motion?: { lean: boolean; turn: boolean }) =>
  Object.fromEntries(deviceCheckSteps({ status, motion }).map((step) => [step.id, step.state]));

const cameraReady = { ...INITIAL_DEVICES, camera: 'ready', vision: 'ready' } as const;
const postureReady = { ...cameraReady, calibration: 'ready' } as const;
const allReady = { ...postureReady, audioPlayback: 'ready' } as const;

describe('deviceCheckSteps', () => {
  it('walks camera, posture, sound and done as each device group passes', () => {
    expect(at(INITIAL_DEVICES)).toEqual({
      camera: 'waiting',
      posture: 'waiting',
      sound: 'waiting',
      done: 'waiting',
    });
    expect(at(cameraReady).camera).toBe('done');
    expect(at(postureReady).posture).toBe('done');
    expect(at(allReady)).toEqual({
      camera: 'done',
      posture: 'done',
      sound: 'done',
      done: 'done',
    });
  });

  it('marks the blocked group instead of the ones after it', () => {
    const states = at({ ...INITIAL_DEVICES, camera: 'failed' });
    expect(states.camera).toBe('blocked');
    expect(states.posture).toBe('waiting');
    expect(at({ ...cameraReady, calibration: 'failed' }).posture).toBe('blocked');
    expect(at({ ...postureReady, audioPlayback: 'failed' }).sound).toBe('blocked');
  });

  it('shows work in progress while a device group is still starting', () => {
    expect(at({ ...INITIAL_DEVICES, camera: 'requesting' }).camera).toBe('busy');
    expect(at({ ...INITIAL_DEVICES, camera: 'ready', vision: 'loading' }).camera).toBe('busy');
    expect(at({ ...cameraReady, calibration: 'running' }).posture).toBe('busy');
  });

  it('keeps posture busy until both motion confirmations are seen', () => {
    expect(at(postureReady, { lean: false, turn: false }).posture).toBe('busy');
    expect(at(postureReady, { lean: true, turn: false }).posture).toBe('busy');
    expect(at(postureReady, { lean: true, turn: true }).posture).toBe('done');
    // 신호가 없는 화면은 확인을 요구하지 않는다.
    expect(at(postureReady).posture).toBe('done');
  });

  it('never blocks on an optional microphone', () => {
    for (const microphone of ['denied', 'failed', 'off'] as const)
      expect(at({ ...allReady, microphone }).sound).toBe('done');
  });

  it('points at the first unfinished step and at the last one when everything passed', () => {
    expect(activeDeviceCheckStep(deviceCheckSteps({ status: INITIAL_DEVICES }))).toBe(0);
    expect(activeDeviceCheckStep(deviceCheckSteps({ status: cameraReady }))).toBe(1);
    expect(activeDeviceCheckStep(deviceCheckSteps({ status: postureReady }))).toBe(2);
    expect(activeDeviceCheckStep(deviceCheckSteps({ status: allReady }))).toBe(3);
  });

  it('folds an out of range index back onto a real step', () => {
    const steps = deviceCheckSteps({ status: INITIAL_DEVICES });
    expect(deviceCheckStepAt(steps, -2).id).toBe('camera');
    expect(deviceCheckStepAt(steps, 9).id).toBe('done');
  });
});

describe('deviceCheckErrorStep', () => {
  it('routes each error code to the one step that owns it', () => {
    expect(deviceCheckErrorStep('CALIBRATION_NO_FACE')).toBe('posture');
    expect(deviceCheckErrorStep('CALIBRATION_UNSTABLE')).toBe('posture');
    expect(deviceCheckErrorStep('MICROPHONE_LOST')).toBe('sound');
    expect(deviceCheckErrorStep('PERMISSION_DENIED')).toBe('camera');
    expect(deviceCheckErrorStep('MODEL_LOAD_TIMEOUT')).toBe('camera');
    // 분류를 모르는 code 는 점검을 처음부터 다시 하게 한다.
    expect(deviceCheckErrorStep('DEVICE_ERROR')).toBe('camera');
  });
});

describe('passedDeviceCheckSteps / latchDeviceCheckSteps', () => {
  const ids = (steps: readonly { id: string; state: string }[]) =>
    Object.fromEntries(steps.map((step) => [step.id, step.state]));
  const walk = (...statuses: readonly DeviceStatus[]) => {
    let passed: ReadonlySet<DeviceCheckStepId> = new Set();
    let steps = deviceCheckSteps({ status: statuses[0]! });
    for (const status of statuses) {
      steps = deviceCheckSteps({ status });
      passed = passedDeviceCheckSteps(passed, steps);
    }
    return { passed, steps, reached: latchDeviceCheckSteps(steps, passed) };
  };

  it('keeps a passed group passed when tracking flickers', () => {
    // S15P21C204-330. vision 이 잠깐 loading 으로 떨어지는 것은 정상이다(눈 깜빡임, 고개 돌리기,
    // 4단계 단추를 누르려고 화면 아래를 보기). 그때마다 1단계로 되감기지 않아야 한다.
    const flicker = { ...allReady, vision: 'loading' } as const;
    expect(at(flicker).camera).toBe('busy');
    expect(activeDeviceCheckStep(deviceCheckSteps({ status: flicker }))).toBe(0);

    const { reached } = walk(allReady, flicker);
    expect(ids(reached).camera).toBe('done');
    expect(activeDeviceCheckStep(reached)).toBe(3);
  });

  it('forgets a group that actually failed and closes ready with it', () => {
    const { passed, reached } = walk(allReady, { ...allReady, camera: 'failed' });
    expect(passed.has('camera')).toBe(false);
    expect(passed.has('done')).toBe(false);
    expect(ids(reached).camera).toBe('blocked');
    // 막힌 단계가 있으면 그 단계로 돌려보낸다. 준비 완료도 열리지 않는다.
    expect(activeDeviceCheckStep(reached)).toBe(0);
    expect(ids(reached).done).not.toBe('done');
  });

  it('never latches a blocked group even if the memory still holds it', () => {
    const steps = deviceCheckSteps({ status: { ...cameraReady, camera: 'failed' } });
    const reached = latchDeviceCheckSteps(steps, new Set<DeviceCheckStepId>(['camera']));
    expect(ids(reached).camera).toBe('blocked');
  });

  it('gives the same memory when the same steps are folded twice', () => {
    // 렌더 중에 불러도 안전해야 한다(StrictMode 는 같은 렌더를 두 번 돌린다).
    const steps = deviceCheckSteps({ status: allReady });
    const once = passedDeviceCheckSteps(new Set(), steps);
    const twice = passedDeviceCheckSteps(once, steps);
    expect([...twice].sort()).toEqual([...once].sort());
  });
});
