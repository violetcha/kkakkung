// S15P21C204-295. 일시 정지 창의 "카메라 · 장치" 갈래. 상태 네 줄과 줄마다 할 수 있는 일 하나가
// 전부다. 조작 안내는 조작 갈래, 소리는 소리 갈래에 있으므로 여기서 다시 말하지 않는다.
// 카메라 동의(S15P21C204-292)는 onStart 를 주는 화면이 한 곳에서 받는다. 여기서는 묻지 않는다.
import type { RefCallback } from 'react';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { deviceFeedback } from '../flow/device-feedback';

const STATE_LABELS: Record<string, string> = {
  idle: '꺼짐',
  off: '사용 안 함',
  ready: '준비됨',
  locked: '권한 필요',
  denied: '허용 안 됨',
  failed: '다시 점검',
  requesting: '권한 확인 중',
  loading: '불러오는 중',
  running: '보정 중',
};

type Row = Readonly<{
  label: string;
  state: string;
  action?: { label: string; disabled: boolean; run(): void };
}>;

export function DevicePane({
  status,
  previewHost,
  busy,
  canAct,
  onStart,
  onCalibrate,
  onMicrophone,
}: {
  status: DeviceStatus;
  previewHost: RefCallback<HTMLDivElement>;
  busy: boolean;
  canAct: boolean;
  onStart(): void;
  onCalibrate(): void;
  onMicrophone(enabled: boolean): void;
}) {
  const cameraOn = status.camera === 'ready';
  const working = busy || status.camera === 'requesting' || status.calibration === 'running';
  const rows: readonly Row[] = [
    {
      label: '웹캠',
      state: status.camera,
      action: {
        label: cameraOn ? '다시 연결' : '카메라 켜고 점검하기',
        disabled: working || !canAct,
        run: onStart,
      },
    },
    { label: '얼굴 추적', state: status.vision },
    {
      label: '중립 자세 보정',
      state: status.calibration,
      action: {
        label: status.calibration === 'ready' ? '다시 보정' : '중립 자세 보정',
        disabled: working || !canAct || !cameraOn,
        run: onCalibrate,
      },
    },
    {
      label: '마이크',
      state: status.microphone,
      action: {
        label: status.microphone === 'ready' ? '끄기' : '연결',
        disabled: working || !canAct,
        run: () => onMicrophone(status.microphone !== 'ready'),
      },
    },
  ];
  return (
    <div className="device-pane">
      <div className="device-preview" ref={previewHost} aria-label="내 웹캠 미리보기" />
      <dl className="device-rows">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd data-state={row.state}>{STATE_LABELS[row.state] ?? row.state}</dd>
            {row.action ? (
              <button
                type="button"
                className="quiet"
                disabled={row.action.disabled}
                onClick={row.action.run}
              >
                {row.action.label}
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </dl>
      {status.errorCode && (
        <p className="pause-note" role="status">
          {deviceFeedback(status.errorCode)}
        </p>
      )}
      <p className="pause-note">
        정면을 보고 얼굴과 양쪽 어깨가 화면에 들어오게 앉으세요. 팔·다리는 보이지 않아도 됩니다.
        카메라 없이 키보드로도 체험할 수 있지만 실제 경기에는 카메라가 필요합니다.
      </p>
    </div>
  );
}
