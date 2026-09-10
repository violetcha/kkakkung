import type { PublicRoundState } from '@kkakkung/protocol/game-schema';
import { loadingDisplay } from './loading-controller';
export function LoadingOverlay({
  round,
  serverNow,
}: {
  round: PublicRoundState;
  serverNow: number | null;
}) {
  const state = loadingDisplay(round, serverNow);
  return (
    <section className="loading-cover" role="status">
      <h2>{round.phase === 'COUNTDOWN' ? '곧 시작합니다' : '미로를 준비하고 있어요'}</h2>
      {state.countdown !== null ? (
        <p className="countdown">{state.countdown > 0 ? state.countdown : '시작 확인 중'}</p>
      ) : (
        <p>모든 참가자의 화면과 연결을 확인하고 있습니다.</p>
      )}
      <p>준비가 끝나면 자동으로 시작합니다.</p>
    </section>
  );
}
