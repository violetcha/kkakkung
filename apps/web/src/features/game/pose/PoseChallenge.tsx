import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { CommandInput } from '../../room/command-lifecycle';
import type { PoseKind } from '../../input/InteractionRuntime';
import { exitCandidate, facesExit } from './challenge-controller';
import type { PoseMissReason } from './pose-evaluator';
import { PoseFigure } from './PoseFigure';
export const POSE_LABELS = {
  left: '내 왼팔 들기',
  right: '내 오른팔 들기',
  y: '양팔 Y자',
} as const;

/**
 * 그림 옆 한 줄. 도전 중에는 긴 문장을 읽을 수 없으므로 지금 할 동작 하나만 짧게 쓴다. 어느 팔인지는
 * 그림의 화살표가 짚는다. 긴 설명(`poseHintText`)은 화면 낭독용으로 남긴다.
 *
 * 늘 떠 있던 팔 프레이밍 문장(S15P21C204-344)은 뺐다. 팔이 화면 밖이면 원인 코드가 서므로
 * 그때만 '한 걸음 뒤로'를 띄운다. 늘 보이는 문장은 읽히지 않는다.
 */
export function poseCueText(
  hint: PoseMissReason | null,
  progress: number,
  waitingMinimum: boolean,
): string {
  if (hint === 'sensor') return '카메라를 봐 주세요';
  if (hint === 'trunk') return '얼굴·어깨가 보이게';
  if (hint === 'arm-offscreen') return '한 걸음 뒤로';
  if (hint === 'arm-low') return '팔을 더 높이';
  if (hint === 'arm-spread') return '팔을 더 벌리기';
  if (hint === 'other-arm') return '반대 팔은 내리기';
  if (progress >= 1) return waitingMinimum ? '좋아요, 조금만 더' : '좋아요!';
  if (progress > 0) return '그대로 유지!';
  return '그림처럼 팔을 드세요';
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
        <div className="pose-guide">
          <PoseFigure kind={challenge.poseKind} progress={progress} hint={hint} />
          <div className="pose-guide-side">
            <p className="pose-guide-cue" data-miss={hint ? 'true' : undefined} aria-hidden>
              {poseCueText(hint, progress, tick < challenge.minSuccessTick)}
            </p>
            {/* 화면 낭독기는 그림을 못 보므로 같은 내용을 문장으로 준다. */}
            <p className="a11y-only" role="status">
              {hint
                ? poseHintText(hint, challenge.poseKind)
                : '얼굴과 양 어깨가 카메라에 들어오게 하고 자세를 1.2초 유지하세요.'}
            </p>
            <progress className="a11y-only" aria-label="유효 자세 유지" max={1} value={progress} />
            <p className="pose-guide-meta">
              {Math.max(0, Math.ceil((challenge.expiresAtTick - tick) / 20))}초 · 잡힐 수 있어요
            </p>
            <button
              className="quiet"
              onClick={() =>
                send({ type: 'EXIT_CANCEL', payload: { challengeId: challenge.challengeId } })
              }
            >
              Esc 취소
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>{starting ? '도전 준비 중…' : '출구 벽을 마주 보고 E'}</p>
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
