import { useEffect, useState } from 'react';
import type { PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
import type { DeviceStatus, PoseKind, SensorSnapshot } from '../../input/InteractionRuntime';
import type { RequestDisplay } from '../../room/command-lifecycle';
import { createPoseHold } from '../pose/pose-evaluator';
import { POSE_LABELS } from '../pose/PoseChallenge';
import { practicePresenter } from './practice-presenter';
export function PracticeScreen({
  round,
  view,
  devices,
  request,
  readyReported,
  readSensors,
  onReady,
}: {
  round: PublicRoundState;
  view: PrivateView;
  devices: DeviceStatus;
  request?: RequestDisplay;
  readyReported: boolean;
  readSensors(): SensorSnapshot | null;
  onReady(): void;
}) {
  const model = practicePresenter(round, view, devices);
  const [kind, setKind] = useState<PoseKind>('left');
  const [progress, setProgress] = useState(0);
  const scope = model?.role === 'runner' ? model.scope : undefined;
  useEffect(() => {
    if (!scope) return;
    const hold = createPoseHold();
    const timer = window.setInterval(() => {
      const sensors = readSensors();
      setProgress(
        Math.min(
          1,
          hold.observe(sensors, sensors?.runtimeGeneration ?? -1, kind, performance.now()).heldMs /
            1200,
        ),
      );
    }, 100);
    return () => {
      clearInterval(timer);
      hold.reset();
    };
  }, [scope, kind, readSensors]);
  if (!model) return null;
  const submitted = readyReported && request?.status === 'applied';
  const pending = request?.status === 'pending' || request?.status === 'waiting-view';
  return (
    <section className="game-panel" aria-label="역할 연습">
      <h2>{model.role === 'runner' ? '도망자' : '술래'} 연습</h2>
      <p>
        {model.role === 'runner'
          ? '3분 안에 도망자 2명이 출구의 포즈 도전에 성공하면 승리합니다.'
          : '도망자 2명을 포획하거나, 3분 동안 도망자 2명의 탈출을 막으면 승리합니다.'}
      </p>
      {model.role === 'runner' ? (
        <p>가까이 보이는 도망자 아군과 지도를 교환하고 출구에서 사용할 포즈를 연습해 보세요.</p>
      ) : (
        <p>1·2로 장비를 고르고 F를 한 번 눌러 설치하세요. 설치 중 F를 다시 누르면 취소합니다.</p>
      )}
      <p>전원 준비 또는 최대 60초 후 서버가 다음 단계를 정합니다.</p>
      {model.role === 'runner' && (
        <>
          <label htmlFor="practice-pose">출구에서 사용할 상체 포즈 연습</label>
          <select
            id="practice-pose"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as PoseKind);
              setProgress(0);
            }}
          >
            {(['left', 'right', 'y'] as const).map((value) => (
              <option key={value} value={value}>
                {POSE_LABELS[value]}
              </option>
            ))}
          </select>
          <progress aria-label="연습 자세 유지" max={1} value={progress} />
          <p>
            {progress >= 1
              ? '1.2초 자세 유지 확인'
              : '얼굴과 상체를 카메라에 두고 선택한 자세를 유지하세요.'}
          </p>
        </>
      )}
      <button disabled={!model.canReady || pending || submitted} onClick={onReady}>
        {submitted
          ? '준비 신고 확인 · 서버 전환 대기'
          : pending
            ? '준비 신고 중…'
            : '연습 준비 완료'}
      </button>
      {!model.canReady && (
        <p role="status">장치 준비가 필요합니다. 시간이 지나도 준비를 대신 완료하지 않습니다.</p>
      )}
    </section>
  );
}
