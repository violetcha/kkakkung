import type { PublicRoundState } from '@kkakkung/protocol/game-schema';
import { loadingProgress } from './loading-progress';

/**
 * S15P21C204-275. 경기 시작 전 대기 한 화면.
 * 미로 준비 → 화면·연결 확인 → 시작을 한 진행표시로 보여 주고, 내 대기 항목과 준비 실패
 * 복귀 안내도 같은 화면 안에 둔다.
 */
export function LoadingOverlay({
  round,
  serverNow,
  pending = [],
}: {
  round: PublicRoundState;
  serverNow: number | null;
  /** 내 쪽에서 아직 못 낸 준비 항목(GAME_LOADING). 비어 있으면 다른 참가자를 기다리는 중이다. */
  pending?: readonly string[];
}) {
  const progress = loadingProgress({ round, serverNow, pending });
  if (!progress) return null;
  const step = progress.steps[progress.active];
  return (
    <section className="loading-cover" role="status" aria-label="경기 준비">
      <h2>경기를 준비하고 있어요</h2>
      <ol className="loading-steps" aria-label="준비 진행">
        {progress.steps.map((item) => (
          <li
            key={item.id}
            data-state={item.state}
            aria-current={item.state === 'busy' || undefined}
          >
            <span aria-hidden="true">{item.state === 'done' ? '✓' : item.index + 1}</span>{' '}
            {item.label}
          </li>
        ))}
      </ol>
      {progress.countdown !== null ? (
        <p className="countdown">{progress.countdown > 0 ? progress.countdown : '시작 확인 중'}</p>
      ) : (
        <p>
          {progress.pending.length > 0
            ? `내 준비 대기: ${progress.pending.join(' · ')}`
            : step?.id === 'map'
              ? '미로를 만들고 모두에게 같은 지도를 나눠 주는 중입니다.'
              : '모든 참가자의 화면과 연결을 확인하고 있습니다.'}
        </p>
      )}
      {progress.notice ? (
        <p className="loading-notice" role="alert">
          {progress.notice}
        </p>
      ) : (
        <p>준비가 끝나면 자동으로 시작합니다.</p>
      )}
    </section>
  );
}
