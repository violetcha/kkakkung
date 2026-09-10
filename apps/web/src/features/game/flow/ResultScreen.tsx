import type { PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
import { resultPresenter } from './result-presenter';
export function ResultScreen({
  round,
  self,
  host,
  onRematch,
}: {
  round: PublicRoundState;
  self: PrivateView['self'];
  host: boolean;
  onRematch(mode: 'same' | 'swap' | 'lobby'): void;
}) {
  const result = resultPresenter(round, self);
  return (
    <section className="result-screen">
      <h2>{result.title}</h2>
      <p>{result.message}</p>
      <p>
        탈출 {result.counts.escaped} · 포획 {result.counts.captured} · 활동 중인 도망자{' '}
        {result.counts.active}
      </p>
      {result.remaining !== null && <p>남은 시간 {result.remaining}초</p>}
      <p className="notice">미디어 회수 완료 여부는 서버 확인이 필요합니다.</p>
      {host && ['RESULT', 'ABORTED'].includes(round.phase) && (
        <div className="actions">
          <button onClick={() => onRematch('same')}>같은 팀으로 재경기</button>
          <button onClick={() => onRematch('swap')}>역할 바꿔 재경기</button>
          <button onClick={() => onRematch('lobby')}>로비로 돌아가기</button>
        </div>
      )}
    </section>
  );
}
