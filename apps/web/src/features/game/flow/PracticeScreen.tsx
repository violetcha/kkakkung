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
  const scope = model?.scope;
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
        몸을 기울여 이동하고 고개를 돌려 방향을 바꾸세요. 가시 아군과 지도를 교환할 수 있습니다.
      </p>
      {model.role === 'tagger' && <p>1·2로 장비를 고른 뒤 설치·취소를 연습하세요.</p>}
      <p>전원 준비 또는 최대 60초 후 서버가 다음 단계를 정합니다.</p>
      <label htmlFor="practice-pose">상체 포즈 연습</label>
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
