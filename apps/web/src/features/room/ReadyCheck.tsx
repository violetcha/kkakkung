// S15P21C204-295. 대기실에서 준비를 누르면 뜨는 창. 물어보는 것은 둘뿐이다: 앞으로 기울이기와
// 고개 돌리기. 지시는 카메라 화면 안에 크게 띄우고, 둘 다 확인되면 화면이 스스로 준비를 보고하고
// 닫힌다(ProductApp). 자세한 장치 값·소리 점검은 설정 창(조작 · 장치)에 있다.
import type { ReactNode } from 'react';
import type { DeviceStatus } from '../devices/device-status';
import type { MotionCheck } from '../game/flow/motion-check';
import { deviceFeedback } from '../game/flow/device-feedback';

/** 지금 해야 할 일 한 줄. 화면 안에 이 문장만 크게 띄운다. */
export function readyCue(status: DeviceStatus, motion: MotionCheck): string {
  if (status.camera !== 'ready') return '카메라를 켜는 중…';
  if (status.vision !== 'ready') return '얼굴 추적을 준비하는 중…';
  if (status.calibration !== 'ready') return '정면을 보고 가만히 계세요';
  if (!motion.lean) return '몸을 앞으로 기울여 보세요';
  if (!motion.turn) return '고개를 왼쪽으로 돌려 보세요';
  return '확인 완료';
}

export function ReadyCheck({
  status,
  motion,
  previewHost,
  onCancel,
  onRetry,
  extra,
}: {
  status: DeviceStatus;
  motion: MotionCheck;
  previewHost(element: HTMLDivElement | null): void;
  onCancel(): void;
  onRetry(): void;
  extra?: ReactNode;
}) {
  const blocked = status.camera === 'failed' || status.vision === 'failed';
  const done = motion.lean && motion.turn;
  const scanning = !blocked && !done;
  const steps = [
    { done: motion.lean, label: '앞으로 기울이기' },
    { done: motion.turn, label: '고개 돌리기' },
  ];
  return (
    <section className="ready-check" aria-label="준비 점검">
      <div className="ready-check-stage" data-scanning={scanning} data-done={done}>
        {/* 카메라는 가리지 않는다. 지시는 화면 바로 아래 띠에 둔다. */}
        <div className="ready-check-lens">
          <div className="ready-check-view" ref={previewHost} aria-label="내 카메라" />
          {/* 캠코더가 나를 훑는 느낌. 선 한 줄이 위에서 아래로 지나간다. */}
          {scanning && <span className="ready-check-scan" aria-hidden="true" />}
          {!blocked && <span className="ready-check-frame" aria-hidden="true" />}
        </div>
        {!blocked && (
          <p className="ready-check-cue" role="status">
            <span className="ready-check-eyebrow">{done ? '확인' : '스캔 중'}</span>
            {readyCue(status, motion)}
          </p>
        )}
      </div>
      {blocked ? (
        <div className="ready-check-blocked" role="alert">
          <p>{status.errorCode ? deviceFeedback(status.errorCode) : '카메라를 켜지 못했습니다.'}</p>
          <button type="button" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : (
        <ol className="ready-check-steps" aria-label="자세 확인">
          {steps.map((step) => (
            <li key={step.label} data-done={step.done}>
              <span aria-hidden="true">{step.done ? '✓' : '○'}</span> {step.label}
            </li>
          ))}
        </ol>
      )}
      <div className="actions">
        <button type="button" className="quiet" onClick={onCancel}>
          나중에 하기
        </button>
        {extra}
      </div>
    </section>
  );
}
