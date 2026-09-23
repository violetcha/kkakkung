// S15P21C204-295. 경기 화면 우상단의 "내 캐릭터" 창. 혼자 연습(튜토리얼)에 있던 것을 실제
// 경기·팀 연습에도 둔다. 상대가 보는 내 아바타에 게시되는 가공 얼굴이 붙고, 그 아래 단추
// 하나로 카메라를 켜고 중립 자세를 다시 잡는다. 장치 값은 설정 창(조작 · 장치)에 있다.
import type { ActiveSelf } from '@kkakkung/protocol/game-schema';
import type { DeviceStatus } from '../../devices/device-status';
import { SelfAvatarView } from '../solo/SelfAvatarView';
import { StaticNoise } from '../solo/StaticNoise';
import { MotionGauges } from '../solo/MotionGauges';
import { cameraAction } from './camera-action';

/** 캠코더. 카메라를 아직 켜지 않았을 때. 작은 크기에서 알아볼 수 있게 몸통·렌즈만 남겼다. */
const CameraIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="2" y="6.5" width="14" height="11" rx="0.5" />
    <path d="M16 12l6-3.5v7z" />
    <circle cx="9" cy="12" r="3" />
  </svg>
);
/** 두 선 사이에 선 사람. 중립 자세 보정. */
const PostureIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.5 3.5v17M20.5 3.5v17" />
    <circle cx="12" cy="7" r="2.5" />
    <path d="M12 9.5v11M7.5 13h9" />
  </svg>
);

export function SelfCorner({
  self,
  devices,
  busy = false,
  renderTick,
  faceStream,
  onCamera,
  onCalibrate,
}: {
  self: ActiveSelf;
  devices: DeviceStatus;
  busy?: boolean;
  renderTick(): number | null;
  /** 게시되는 것과 같은 가공 얼굴. 아직 없으면 null(그림 얼굴 유지). */
  faceStream(): MediaStream | null;
  onCamera(): void;
  onCalibrate(): void;
}) {
  const action = cameraAction(devices, busy);
  return (
    <div className="solo-corner">
      <div className="solo-self" aria-hidden="true">
        <SelfAvatarView self={self} renderTick={renderTick} faceStream={faceStream} />
        <StaticNoise />
        <MotionGauges />
      </div>
      <button
        type="button"
        className="solo-camera-button"
        data-state={action.state}
        disabled={action.disabled}
        onClick={action.kind === 'camera' ? onCamera : onCalibrate}
        aria-label={action.label}
        title={action.label}
      >
        {action.kind === 'camera' ? CameraIcon : PostureIcon}
      </button>
    </div>
  );
}
