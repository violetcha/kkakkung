import { useState } from 'react';
import type { DeviceStatus, InteractionState } from '../../input/InteractionRuntime';

export function LocalControls({
  status,
  mode,
  previewHost,
  onKeyboard,
  onMotion,
}: {
  status: DeviceStatus;
  mode: InteractionState['mode'];
  previewHost(element: HTMLDivElement | null): void;
  onKeyboard(): void;
  onMotion(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const calibrating = busy || status.calibration === 'running';
  return (
    <aside className="local-controls" aria-label="내 카메라와 조작">
      <div className="preview-host" ref={previewHost} aria-label="내 웹캠 미리보기" />
      <div>
        <p>
          <strong>{mode === 'motion' ? '얼굴·상체 조작' : '키보드 조작'}</strong>
        </p>
        <p>
          {mode === 'motion'
            ? '고개를 좌우로 돌리면 90° 회전합니다. 정면으로 돌아온 뒤 다시 돌리세요. 몸을 앞뒤로 기울이면 전진·후진합니다.'
            : 'W/S 또는 ↑/↓: 전진·후진 · A/D 또는 ←/→: 90° 회전. 회전 키는 한 번씩 눌러 주세요.'}
        </p>
        <div className="actions">
          <button disabled={calibrating || mode === 'keyboard'} onClick={onKeyboard}>
            키보드로 조작
          </button>
          <button
            disabled={calibrating || status.camera !== 'ready'}
            onClick={() => {
              setBusy(true);
              void onMotion().finally(() => setBusy(false));
            }}
          >
            {calibrating ? '정면을 보고 보정 중…' : '모션 다시 보정'}
          </button>
        </div>
        {status.camera !== 'ready' && (
          <p role="status">카메라를 켜면 내 영상이 여기에 표시됩니다.</p>
        )}
        {status.camera === 'ready' && status.calibration !== 'ready' && (
          <p role="status">
            정면을 보고 얼굴과 양쪽 어깨·팔이 보이도록 자세를 맞춘 뒤 보정해 주세요.
          </p>
        )}
        {status.errorCode && (
          <p role="status">
            추적 상태를 확인해 주세요. 키보드 조작을 사용할 수 있습니다. ({status.errorCode})
          </p>
        )}
      </div>
    </aside>
  );
}
