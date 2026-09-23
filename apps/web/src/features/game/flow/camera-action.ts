// S15P21C204-295. 우상단 단추 하나가 장치 점검의 두 동작을 잇는다. 카메라를 켜면 같은 자리에서
// 중립 자세 보정으로 바뀌고, 보정까지 끝나면 다시 보정할 수 있다. 혼자 연습과 실제 경기가
// 같은 규칙을 쓰도록 판단만 따로 뒀다. 그리기는 화면이 한다.
import type { DeviceStatus } from '../../devices/device-status';

export type CameraActionKind = 'camera' | 'posture';
export type CameraAction = Readonly<{
  /** 단추의 모양을 고르는 값. 'busy' 는 누를 수 없다. */
  state: 'idle' | 'busy' | 'ready' | 'failed';
  kind: CameraActionKind;
  label: string;
  disabled: boolean;
}>;

export function cameraAction(
  devices: Pick<DeviceStatus, 'camera' | 'calibration'>,
  busy = false,
): CameraAction {
  if (busy || devices.camera === 'requesting')
    return { state: 'busy', kind: 'camera', label: '카메라 연결 중', disabled: true };
  if (devices.camera !== 'ready')
    return {
      state: devices.camera === 'failed' ? 'failed' : 'idle',
      kind: 'camera',
      label: devices.camera === 'failed' ? '카메라 다시 연결' : '카메라 연결',
      disabled: false,
    };
  if (devices.calibration === 'running')
    return { state: 'busy', kind: 'posture', label: '중립 자세 보정 중', disabled: true };
  return {
    state:
      devices.calibration === 'ready'
        ? 'ready'
        : devices.calibration === 'failed'
          ? 'failed'
          : 'idle',
    kind: 'posture',
    label: devices.calibration === 'ready' ? '중립 자세 다시 보정' : '중립 자세 보정',
    disabled: false,
  };
}
