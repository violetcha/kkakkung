import { describe, expect, it } from 'vitest';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { INITIAL_DEVICES } from './device-readiness';
import {
  activeDeviceCheckStep,
  deviceCheckErrorStep,
  deviceCheckStepAt,
  deviceCheckSteps,
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
