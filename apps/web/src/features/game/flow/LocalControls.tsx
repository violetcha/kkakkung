import { useState } from 'react';
import type { DeviceStatus, InteractionState } from '../../input/InteractionRuntime';
import { deviceFeedback } from './device-feedback';

export function LocalControls({
  status,
  mode,
  previewHost,
  onKeyboard,
  onMotion,
  onRecover,
  onMicrophone,
  canRecover = true,
  compact = false,
}: {
  status: DeviceStatus;
  mode: InteractionState['mode'];
  previewHost(element: HTMLDivElement | null): void;
  onKeyboard(): void;
  onMotion(): Promise<void>;
  onRecover(): Promise<void>;
  onMicrophone(enabled: boolean): Promise<void>;
  canRecover?: boolean;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const calibrating = busy || status.calibration === 'running';
  return (
    <aside className="local-controls" aria-label="내 카메라와 조작">
      <div className="preview-host" ref={previewHost} aria-label="내 웹캠 미리보기" />
      <details open={!compact}>
        <summary>조작 안내 · 장치 설정</summary>
        <p>
          <strong>{mode === 'motion' ? '얼굴·상체 조작' : '키보드 조작'}</strong>
        </p>
        <p>
          {mode === 'motion'
            ? '고개를 좌우로 돌리면 90° 회전합니다. 정면으로 돌아온 뒤 다시 돌리세요. 몸을 앞뒤로 기울이면 전진·후진합니다.'
            : 'W/S 또는 ↑/↓: 전진·후진 · A/D 또는 ←/→: 90° 회전. 키를 잠깐 누르고 있어야 움직입니다. 반응 시간은 모션과 같고, 회전은 키를 놓은 뒤 다시 누르세요.'}
        </p>
        <div className="actions">
          <button disabled={mode === 'keyboard'} onClick={onKeyboard}>
            키보드로 조작
          </button>
          <button
            disabled={
              calibrating || !canRecover || status.camera !== 'ready' || status.vision === 'failed'
            }
            onClick={() => {
              setBusy(true);
              void onMotion().finally(() => setBusy(false));
            }}
          >
            {calibrating ? '추적 준비·보정 중…' : '보정 후 모션으로 조작'}
          </button>
          <button
            disabled={busy || !canRecover}
            onClick={() => {
              setBusy(true);
              void onRecover().finally(() => setBusy(false));
            }}
          >
            {busy ? '장치 점검 중…' : '장치 다시 연결·점검'}
          </button>
          <button
            disabled={busy || !canRecover}
            onClick={() => {
              setBusy(true);
              void onMicrophone(status.microphone !== 'ready').finally(() => setBusy(false));
            }}
          >
            {status.microphone === 'ready' ? '마이크 끄기' : '마이크 연결·재시도'}
          </button>
        </div>
        {status.camera !== 'ready' && (
          <p role="status">
            장치를 다시 연결해 점검할 수 있습니다. 연습·경기에서는 키보드로 계속 조작할 수 있습니다.
          </p>
        )}
        {status.camera === 'ready' && status.calibration !== 'ready' && (
          <p role="status">정면을 보고 얼굴과 양쪽 어깨가 보이도록 자세를 맞춘 뒤 보정해 주세요.</p>
        )}
      </details>
      {status.errorCode && <p role="status">{deviceFeedback(status.errorCode)}</p>}
    </aside>
  );
}
