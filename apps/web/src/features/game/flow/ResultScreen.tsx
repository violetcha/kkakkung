import type { PrivateView, PublicRoundState } from '@kkakkung/protocol/game-schema';
import { resultPresenter } from './result-presenter';
import type { RequestDisplay } from '../../room/command-lifecycle';
import { commandFeedback } from './command-feedback';
export function ResultScreen({
  round,
  self,
  host,
  request,
  connectedCount,
  onRematch,
}: {
  round: PublicRoundState;
  self: PrivateView['self'];
  host: boolean;
  request?: RequestDisplay;
  connectedCount: number;
  onRematch(mode: 'same' | 'swap' | 'lobby'): void;
}) {
  const result = resultPresenter(round, self);
  const pending =
    round.rematchState === 'requested' ||
    (request !== undefined && ['pending', 'waiting-view', 'applied'].includes(request.status));
  const ended = ['RESULT', 'ABORTED'].includes(round.phase);
  return (
    <section className="result-screen">
      <h2>{result.title}</h2>
      {result.personalResult && <p aria-label="나의 결과">{result.personalResult}</p>}
      {result.teamResult && <p aria-label="우리 팀 결과">{result.teamResult}</p>}
      <p>{result.message}</p>
      <p>
        탈출 {result.counts.escaped} · 포획 {result.counts.captured} ·{' '}
        {ended ? '종료 시 남은 도망자' : '활동 중인 도망자'} {result.counts.active}
      </p>
      {result.remaining !== null && <p>남은 시간 {result.remaining}초</p>}
      {ended && (
        <p role="status" className="notice">
          {pending
            ? '다음 경기를 준비하고 있습니다. 잠시 기다려 주세요.'
            : round.rematchState === 'settling'
              ? '다음 경기를 위해 연결을 정리하고 있습니다. 재경기를 선택하면 준비되는 대로 이동합니다.'
              : host
                ? '재경기 방식을 선택해 주세요. 모두 다시 준비한 뒤 시작합니다.'
                : '방장이 다음 경기를 선택하기를 기다리고 있습니다.'}
        </p>
      )}
      {ended && connectedCount < 6 && (
        <p>현재 {connectedCount}/6명입니다. 로비에서 추가 참가자를 모은 뒤 시작할 수 있습니다.</p>
      )}
      {commandFeedback(request) && <p role="status">{commandFeedback(request)}</p>}
      {host && ended && (
        <div className="actions">
          <button disabled={pending} onClick={() => onRematch('same')}>
            같은 팀으로 재경기
          </button>
          <button disabled={pending} onClick={() => onRematch('swap')}>
            역할 바꿔 재경기
          </button>
          <button disabled={pending} onClick={() => onRematch('lobby')}>
            로비로 돌아가기
          </button>
        </div>
      )}
    </section>
  );
}
