// D-01 / IN-01. DeviceStatus의 제품 구현과 순수 전이 규칙.
// EXEC-CONTRACT-3 tests/contracts/shared/types.ts의 DeviceStatus와 같은 모양을 소유 모듈에 구현한다.
// 문서용 타입을 런타임 의존성으로 import하지 않는다.

export type DeviceStatus = Readonly<{
  camera: 'idle' | 'requesting' | 'ready' | 'failed';
  microphone: 'off' | 'requesting' | 'ready' | 'denied' | 'failed';
  vision: 'idle' | 'loading' | 'ready' | 'failed';
  calibration: 'idle' | 'running' | 'ready' | 'failed';
  audioPlayback: 'locked' | 'ready' | 'failed';
  errorCode: string | null;
}>;

export const INITIAL_DEVICE_STATUS: DeviceStatus = Object.freeze({
  camera: 'idle',
  microphone: 'off',
  vision: 'idle',
  calibration: 'idle',
  audioPlayback: 'locked',
  errorCode: null,
});

export type DeviceStatusPatch = Partial<{
  camera: DeviceStatus['camera'];
  microphone: DeviceStatus['microphone'];
  vision: DeviceStatus['vision'];
  calibration: DeviceStatus['calibration'];
  audioPlayback: DeviceStatus['audioPlayback'];
  errorCode: string | null;
}>;

const KEYS = [
  'camera',
  'microphone',
  'vision',
  'calibration',
  'audioPlayback',
  'errorCode',
] as const;

export function isSameDeviceStatus(left: DeviceStatus, right: DeviceStatus): boolean {
  return KEYS.every((key) => left[key] === right[key]);
}

/** 값이 실제로 바뀔 때만 새 객체를 만든다. 같은 값 재적용은 callback을 반복하지 않는다. */
export function patchDeviceStatus(current: DeviceStatus, patch: DeviceStatusPatch): DeviceStatus {
  const next: DeviceStatus = { ...current, ...patch };
  return isSameDeviceStatus(current, next) ? current : Object.freeze(next);
}

/**
 * 브라우저 오류를 안전 code로만 바꾼다.
 * 장치 라벨·사용자 메시지 원문을 상태에 넣지 않는다.
 */
export function deviceErrorCode(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'PERMISSION_DENIED';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'DEVICE_NOT_FOUND';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'DEVICE_IN_USE';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'CONSTRAINTS_UNSATISFIED';
    case 'AbortError':
      return 'DEVICE_ABORTED';
    case 'SecurityError':
      return 'INSECURE_CONTEXT';
    case 'TypeError':
      return 'DEVICE_UNAVAILABLE';
    default:
      return 'DEVICE_ERROR';
  }
}

/** 권한 거부는 microphone denied, 나머지는 failed다. 마이크 실패를 카메라 실패로 합치지 않는다. */
export function microphoneStateForError(code: string): DeviceStatus['microphone'] {
  return code === 'PERMISSION_DENIED' ? 'denied' : 'failed';
}
