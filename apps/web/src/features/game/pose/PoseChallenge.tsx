import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { CommandInput } from '../../room/command-lifecycle';
import type { PoseKind } from '../../input/InteractionRuntime';
import { exitCandidate, facesExit } from './challenge-controller';
import type { PoseMissReason } from './pose-evaluator';
export const POSE_LABELS = {
  left: '내 왼팔 들기',
  right: '내 오른팔 들기',
  y: '양팔 Y자',
} as const;

/**
 * S15P21C204-344. 팔이 프레임 밖이면 자세가 맞아도 판정이 서지 않는데, 진행 막대만으로는
 * 그 이유를 알 수 없다. 조건을 항상 적어 둔다.
 *
 * 처음에는 팔 가시성을 프레임마다 읽어 안 보일 때만 띄웠다. 그러면 팔이 경계에 걸칠 때마다
 * 문구가 깜빡인다 — S15P21C204-330 과 같은 실수다. 순간 신호를 화면에 그대로 물리지 않는다.
 * 조건은 도전 내내 변하지 않으므로 항상 같은 자리에 같은 문구로 둔다.
 *
 * S15P21C204-354. 한 팔만 드는 자세는 **드는 쪽 팔만** 화면에 들어오면 된다. 내린 팔까지
 * 요구하던 판정을 고쳤으므로 이 문구도 같이 고친다 — 안내가 실제 판정보다 엄하면 사람들이
 * 불필요하게 물러선다. 경기와 혼자 체험이 같은 문구를 쓰도록 여기 한 곳에만 둔다.
 */
export function PoseArmsNotice({ kind }: { kind: PoseKind }) {
  return (
    <p className="pose-arms-notice">
      {kind === 'y'
        ? '두 팔의 팔꿈치와 손목이 모두 화면에 들어와야 인식됩니다.'
        : `${kind === 'left' ? '왼팔' : '오른팔'}의 팔꿈치와 손목이 화면에 들어와야 인식됩니다. 반대쪽 팔은 내려도 됩니다.`}{' '}
      진행이 오르지 않으면 카메라에서 조금 물러나 주세요.
    </p>
  );
}

/** 디바운스를 거친 원인 코드를 문구로 옮긴다. 판정기는 문구를 모른다. */
export function poseHintText(hint: PoseMissReason, kind: PoseKind): string {
  const arm = kind === 'left' ? '왼팔' : kind === 'right' ? '오른팔' : '두 팔';
  if (hint === 'sensor') return '카메라 자세 인식이 끊겼습니다. 얼굴이 화면에 들어오게 해 주세요.';
  if (hint === 'trunk') return '얼굴과 양 어깨가 함께 보이게 해 주세요.';
  if (hint === 'arm-offscreen')
    return `${arm}의 팔꿈치나 손목이 화면 밖입니다. 카메라에서 조금 물러나 주세요.`;
  if (hint === 'arm-low') return `${arm}을 어깨 위로 더 올려 주세요.`;
  if (hint === 'arm-spread') return '두 팔을 바깥쪽으로 벌려 Y자를 만들어 주세요.';
  return `${kind === 'left' ? '오른팔' : '왼팔'}은 내려 주세요.`;
}

export function PoseChallenge({
  view,
  tick,
  progress,
  hint,
  starting,
  send,
}: {
  view: PrivateView;
  tick: number;
  progress: number;
  hint: PoseMissReason | null;
  starting: boolean;
  send(command: CommandInput): void;
}) {
  const self = view.self;
  if (self?.status !== 'ACTIVE' || self.role !== 'runner') return null;
  const challenge = self.challenge;
  const exit = exitCandidate(view);
  if (!challenge && !exit && !starting) return null;
  return (
    <section className="game-panel" aria-label="출구 도전">
      <h2>{challenge ? POSE_LABELS[challenge.poseKind] : '내 출구'}</h2>
      {challenge ? (
        <>
          <p>
            얼굴과 양 어깨가 카메라에 들어오게 하고 자세를 1.2초 유지하세요. 도전 중에도 포획될 수
            있습니다.
          </p>
          <progress aria-label="유효 자세 유지" max={1} value={progress} />
          <PoseArmsNotice kind={challenge.poseKind} />
          {/* 왜 진행이 안 오르는지. 컨트롤러가 디바운스한 뒤에만 값이 서므로 깜빡이지 않는다. */}
          {hint && (
            <p className="pose-hint" role="status">
              {poseHintText(hint, challenge.poseKind)}
            </p>
          )}
          <p>
            {Math.max(0, Math.ceil((challenge.expiresAtTick - tick) / 20))}초 남음
            {tick < challenge.minSuccessTick ? ' · 최소 수행 시간 확인 중' : ''}
          </p>
          <button
            className="quiet"
            onClick={() =>
              send({ type: 'EXIT_CANCEL', payload: { challengeId: challenge.challengeId } })
            }
          >
            도전 취소
          </button>
        </>
      ) : (
        <>
          <p>
            {starting ? '서버의 도전 시작을 확인하고 있습니다.' : '출구 벽을 향한 뒤 시작하세요.'}
          </p>
          <button
            disabled={
              starting ||
              !exit ||
              !facesExit(self, exit) ||
              !!self.action ||
              self.restraintUntilTick !== null
            }
            onClick={() => exit && send({ type: 'EXIT_START', payload: { exitId: exit.exitId } })}
          >
            탈출 도전 · E
          </button>
        </>
      )}
    </section>
  );
}
