import { useState } from 'react';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import { deviceReady } from './device-readiness';
import { deviceFeedback } from './device-feedback';
export function DeviceCheckScreen({
  status,
  ready,
  onStart,
  onReady,
  previewHost,
}: {
  status: DeviceStatus;
  ready: boolean;
  onStart(microphone: boolean): Promise<void>;
  onReady(value: boolean): void;
  previewHost?(element: HTMLDivElement | null): void;
}) {
  const [microphone, setMicrophone] = useState(false);
  const [busy, setBusy] = useState(false);
  const labels = {
    camera: '웹캠',
    vision: '얼굴 추적·가공',
    calibration: '중립 자세 보정',
    audioPlayback: '소리 재생',
    microphone: '마이크 (선택)',
  } as const;
  const stateLabels: Record<string, string> = {
    idle: '점검 전',
    off: '사용 안 함',
    ready: '준비됨',
    locked: '권한 필요',
    denied: '허용 안 됨',
    failed: '다시 점검',
    requesting: '권한 확인 중',
    loading: '불러오는 중',
    running: '보정 중',
  };
  return (
    <section className={previewHost ? 'device-check' : 'device-check device-check-with-controls'}>
      <div>
        <h2>플레이 전 장치 점검</h2>
        <p>
          얼굴과 양쪽 어깨·팔꿈치·손이 화면에 들어오도록 앉아 정면을 봐 주세요. 골반이나 다리는
          보이지 않아도 됩니다. 마이크는 사용하지 않아도 됩니다.
        </p>
        <dl>
          {Object.entries(labels).map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{stateLabels[status[key as keyof typeof labels]]}</dd>
            </div>
          ))}
        </dl>
        <label>
          <input
            type="checkbox"
            checked={microphone}
            disabled={busy || status.calibration === 'running'}
            onChange={(e) => setMicrophone(e.target.checked)}
          />{' '}
          마이크 사용
        </label>
        <div className="actions">
          <button
            disabled={busy || status.calibration === 'running'}
            onClick={() => {
              setBusy(true);
              void onStart(microphone).finally(() => setBusy(false));
            }}
          >
            {busy ? '장치 점검 중…' : '장치 켜고 보정하기'}
          </button>
          <button disabled={!ready && !deviceReady(status)} onClick={() => onReady(!ready)}>
            {ready ? '준비 취소' : '준비 완료'}
          </button>
        </div>
        {status.errorCode && <p role="alert">{deviceFeedback(status.errorCode)}</p>}
      </div>
      {previewHost && (
        <div className="preview-host" ref={previewHost} aria-label="내 웹캠 미리보기" />
      )}
    </section>
  );
}
