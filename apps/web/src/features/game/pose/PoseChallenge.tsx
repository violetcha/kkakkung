import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { CommandInput } from '../../room/command-lifecycle';
import { exitCandidate } from './challenge-controller';
export const POSE_LABELS = {
  left: '내 왼팔 들기',
  right: '내 오른팔 들기',
  y: '양팔 Y자',
} as const;
export function PoseChallenge({
  view,
  tick,
  progress,
  starting,
  send,
}: {
  view: PrivateView;
  tick: number;
  progress: number;
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
            얼굴과 상체를 카메라에 두고 자세를 1.2초 유지하세요. 도전 중에도 포획될 수 있습니다.
          </p>
          <progress aria-label="유효 자세 유지" max={1} value={progress} />
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
              self.dir !== exit.wall.side ||
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
