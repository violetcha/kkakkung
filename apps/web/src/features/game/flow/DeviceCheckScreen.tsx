import { useState } from 'react';
import type { DeviceStatus } from '../../input/InteractionRuntime';
import type { TestToneResult } from '../../media/audio-preferences';
import { deviceReady } from './device-readiness';
import { deviceFeedback } from './device-feedback';
import { FaceGuidanceNotice } from './FaceGuidanceNotice';
import type { FaceConditionNotice } from '../../media/face-condition';
import {
  activeDeviceCheckStep,
  deviceCheckErrorStep,
  deviceCheckStepAt,
  deviceCheckSteps,
  type DeviceCheckStepId,
} from './device-check-steps';
import type { MotionCheck } from './motion-check';

const STATE_LABELS: Record<string, string> = {
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

function Value({ label, state }: { label: string; state: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{STATE_LABELS[state] ?? state}</dd>
    </div>
  );
}

/**
 * S15P21C204-273. 장치 점검 네 단계 캐러셀.
 * 단계 판정은 device-check-steps 가 하고 여기서는 지금 단계만 그린다.
 * 오류 문구는 그 code 를 낸 단계 안에서만 보여 준다.
 */
export function DeviceCheckScreen({
  status,
  ready = false,
  onStart,
  onReady,
  previewHost,
  faceGuidance,
  motion,
  onCalibrate,
  onMicrophone,
  onTestTone,
  heading = '플레이 전 장치 점검',
}: {
  status: DeviceStatus;
  ready?: boolean;
  onStart(microphone: boolean): Promise<void>;
  /** 준비 완료를 보고할 곳이 없는 화면(개인 체험)은 넘기지 않는다. */
  onReady?(value: boolean): void;
  previewHost?(element: HTMLDivElement | null): void;
  faceGuidance?: FaceConditionNotice | null;
  /** 기울이기·고개 돌리기를 각 1회 봤는지. 신호가 없는 화면은 넘기지 않는다. */
  motion?: MotionCheck | null;
  onCalibrate?(): Promise<void>;
  onMicrophone?(enabled: boolean): Promise<void>;
  onTestTone?(): Promise<TestToneResult>;
  heading?: string;
}) {
  const [microphone, setMicrophone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState<number | null>(null);
  const [tone, setTone] = useState('');
  const steps = deviceCheckSteps({ status, motion });
  const auto = activeDeviceCheckStep(steps);
  const active = Math.min(pinned ?? auto, steps.length - 1);
  const step = deviceCheckStepAt(steps, active);
  const calibrating = status.calibration === 'running';
  const locked = busy || calibrating;
  const errorStep: DeviceCheckStepId | null = status.errorCode
    ? deviceCheckErrorStep(status.errorCode)
    : null;
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work().finally(() => setBusy(false));
  };
  // 어느 단계든 직접 볼 수 있다. 막힌 단계에 갇히지 않게 하되, 어디서 막혔는지는 점이 계속 알린다.
  // 지금 진행 중인 단계를 고르면 고정을 풀어 다음 통과부터 다시 따라간다.
  const go = (index: number) => {
    const next = Math.min(Math.max(index, 0), steps.length - 1);
    setPinned(next === auto ? null : next);
  };
  return (
    <section
      className={previewHost ? 'device-check' : 'device-check device-check-with-controls'}
      aria-label="장치 점검"
    >
      <div className="device-check-flow" data-step={step.id} data-state={step.state}>
        <h2>{heading}</h2>
        <ol className="device-check-dots" aria-label="장치 점검 진행">
          {steps.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="device-check-dot"
                aria-label={`${item.index + 1} ${item.label}`}
                data-state={item.state}
                aria-current={item.index === active ? 'step' : undefined}
                onClick={() => go(item.index)}
              >
                <span aria-hidden="true">{item.index + 1}</span>
                <span className="device-check-dot-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ol>

        {step.id === 'camera' && (
          <div className="device-check-step">
            <h3>1 · 카메라</h3>
            <p>
              얼굴과 양쪽 어깨가 화면에 들어오도록 앉아 정면을 봐 주세요. 팔·손·골반·다리는 보이지
              않아도 됩니다.
            </p>
            <dl>
              <Value label="웹캠" state={status.camera} />
              <Value label="얼굴 추적·가공" state={status.vision} />
            </dl>
            <div className="actions">
              <button disabled={locked} onClick={() => run(() => onStart(microphone))}>
                {busy ? '장치 점검 중…' : '카메라 켜고 점검하기'}
              </button>
            </div>
            <FaceGuidanceNotice notice={faceGuidance} />
          </div>
        )}

        {step.id === 'posture' && (
          <div className="device-check-step">
            <h3>2 · 자세</h3>
            <p>
              편한 중립 자세에서 잠시 멈춰 보정한 뒤, 앞으로 한 번 기울이고 고개를 한 번 돌려
              주세요. 각각 한 번씩 확인하면 다음으로 넘어갑니다.
            </p>
            <dl>
              <Value label="중립 자세 보정" state={status.calibration} />
            </dl>
            {motion && (
              <ul className="device-check-motion" aria-label="동작 확인">
                <li data-done={motion.lean}>{motion.lean ? '✓' : '○'} 앞으로 기울이기</li>
                <li data-done={motion.turn}>{motion.turn ? '✓' : '○'} 고개 돌리기</li>
              </ul>
            )}
            {onCalibrate && (
              <div className="actions">
                <button disabled={locked} onClick={() => run(onCalibrate)}>
                  {calibrating ? '보정 중…' : '중립 자세 다시 보정'}
                </button>
              </div>
            )}
            <FaceGuidanceNotice notice={faceGuidance} />
          </div>
        )}

        {step.id === 'sound' && (
          <div className="device-check-step">
            <h3>3 · 소리</h3>
            <p>
              확인음이 들리는지 확인해 주세요. 마이크는 사용하지 않아도 경기에 참여할 수 있습니다.
            </p>
            <dl>
              <Value label="소리 재생" state={status.audioPlayback} />
              <Value label="마이크 (선택)" state={status.microphone} />
            </dl>
            <label>
              <input
                type="checkbox"
                checked={microphone}
                disabled={locked}
                onChange={(event) => {
                  const next = event.target.checked;
                  setMicrophone(next);
                  if (onMicrophone) run(() => onMicrophone(next));
                }}
              />{' '}
              마이크 사용
            </label>
            <div className="actions">
              {onTestTone && (
                <button
                  disabled={locked || status.audioPlayback !== 'ready'}
                  onClick={() => {
                    setTone('');
                    run(() =>
                      onTestTone()
                        .then((result) =>
                          setTone(
                            result === 'played'
                              ? '짧은 확인음이 재생됐습니다. 소리가 들렸는지 확인해 주세요.'
                              : result === 'muted'
                                ? '전체 음소거를 해제하고 음량을 올려 주세요.'
                                : '소리를 열지 못했습니다. 출력 장치를 확인하고 다시 눌러 주세요.',
                          ),
                        )
                        .catch(() => setTone('소리 점검을 마치지 못했습니다. 다시 눌러 주세요.')),
                    );
                  }}
                >
                  확인음 듣기
                </button>
              )}
              {status.audioPlayback !== 'ready' && (
                <button disabled={locked} onClick={() => run(() => onStart(microphone))}>
                  소리 다시 열기
                </button>
              )}
            </div>
            {tone && <p role="status">{tone}</p>}
          </div>
        )}

        {step.id === 'done' && (
          <div className="device-check-step">
            <h3>4 · 완료</h3>
            <p>
              {!deviceReady(status)
                ? '아직 통과하지 못한 단계가 있습니다. 위 점을 눌러 그 단계로 돌아가 주세요.'
                : onReady
                  ? '점검이 끝났습니다. 준비 완료를 누르면 다른 참가자에게 준비 상태가 보입니다.'
                  : '점검이 끝났습니다. 이제 조작을 연습해 보세요.'}
            </p>
            <dl>
              {steps.slice(0, 3).map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>
                    {item.state === 'done' ? '통과' : item.state === 'blocked' ? '막힘' : '진행 중'}
                  </dd>
                </div>
              ))}
            </dl>
            {onReady && (
              <div className="actions">
                <button disabled={!ready && !deviceReady(status)} onClick={() => onReady(!ready)}>
                  {ready ? '준비 취소' : '준비 완료'}
                </button>
              </div>
            )}
          </div>
        )}

        {errorStep === step.id && status.errorCode && (
          <p role="alert" className="device-check-error">
            {deviceFeedback(status.errorCode)}
          </p>
        )}

        <div className="device-check-nav">
          <button type="button" disabled={active === 0} onClick={() => go(active - 1)}>
            이전 단계
          </button>
          <button
            type="button"
            disabled={active >= steps.length - 1}
            onClick={() => go(active + 1)}
          >
            다음 단계
          </button>
        </div>
      </div>
      {previewHost && (
        <div className="preview-host" ref={previewHost} aria-label="내 웹캠 미리보기" />
      )}
    </section>
  );
}
