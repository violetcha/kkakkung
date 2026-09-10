import type { DeviceStatus } from '../../input/InteractionRuntime';
export const deviceReady = (status: DeviceStatus) =>
  status.camera === 'ready' &&
  status.vision === 'ready' &&
  status.calibration === 'ready' &&
  status.audioPlayback === 'ready';
export const INITIAL_DEVICES: DeviceStatus = {
  camera: 'idle',
  microphone: 'off',
  vision: 'idle',
  calibration: 'idle',
  audioPlayback: 'locked',
  errorCode: null,
};
