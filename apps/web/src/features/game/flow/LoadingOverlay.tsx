import type { PublicRoundState } from '@kkakkung/protocol/game-schema';
import { loadingDisplay } from './loading-controller';
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
  const state = loadingDisplay(round, serverNow);
  return (
    <section className="loading-cover" role="status">
      <h2>{round.phase === 'COUNTDOWN' ? '곧 시작합니다' : '미로를 준비하고 있어요'}</h2>
      {state.countdown !== null ? (
        <p className="countdown">{state.countdown > 0 ? state.countdown : '시작 확인 중'}</p>
      ) : (
        <p>
          {round.phase === 'GAME_LOADING' && pending.length > 0
            ? `내 준비 대기: ${pending.join(' · ')}`
            : '모든 참가자의 화면과 연결을 확인하고 있습니다.'}
        </p>
      )}
      <p>준비가 끝나면 자동으로 시작합니다.</p>
    </section>
  );
}
