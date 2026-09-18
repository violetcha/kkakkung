import type { DeviceStatus } from '../../input/InteractionRuntime';
export const deviceReady = (status: DeviceStatus) =>
  status.camera === 'ready' &&
  status.vision === 'ready' &&
  status.calibration === 'ready' &&
  status.audioPlayback === 'ready';
/**
 * S15P21C204-275. 연습·경기 중 복구 배너를 띄울 조건.
 * 점검을 통과한 뒤 추적에 필요한 장치가 끊긴 상태만 참이다. 마이크는 선택이라 보지 않는다.
 */
export const deviceLost = (status: DeviceStatus) =>
  status.camera !== 'ready' || status.vision !== 'ready' || status.calibration === 'failed';
export const INITIAL_DEVICES: DeviceStatus = {
  camera: 'idle',
  microphone: 'off',
  vision: 'idle',
  calibration: 'idle',
  audioPlayback: 'locked',
  errorCode: null,
};
