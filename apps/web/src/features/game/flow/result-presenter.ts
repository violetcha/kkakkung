import type { PrivateView, PublicRoundState, AbortReason } from '@kkakkung/protocol/game-schema';
const ABORT_LABELS: Record<AbortReason, string> = {
  GAME_CONNECTION_LOST: '게임 연결이 끊겨 경기가 무효 처리되었습니다.',
  SERVER_TICK_OVERLOAD: '서버 지연으로 경기가 무효 처리되었습니다.',
  MEDIA_POLICY_UNCERTAIN: '미디어 권한을 확인하지 못해 경기가 무효 처리되었습니다.',
  MEDIA_UNAVAILABLE: '미디어 연결을 사용할 수 없어 경기가 무효 처리되었습니다.',
  DEMO_OPERATOR_ABORT: '관리자가 라운드를 끝냈습니다.',
};
export function resultPresenter(
  round: PublicRoundState,
  self: PrivateView['self'],
  options: { runners?: number } = {},
) {
  const runners = options.runners ?? 3;
  const ended = round.phase === 'RESULT' || round.phase === 'ABORTED';
  const reason = round.result?.reason;
  const personal =
    self?.status === 'ESCAPED' ? '탈출 성공' : self?.status === 'CAPTURED' ? '포획됨' : null;
  const team = self?.role === 'runner' ? 'runners' : self?.role === 'tagger' ? 'taggers' : null;
  return {
    personalResult:
      ended && personal
        ? round.phase === 'ABORTED'
          ? `경기 중 기록: ${self?.status === 'ESCAPED' ? '탈출' : '포획'} · 경기는 무효 처리되었습니다.`
          : `나의 결과: ${personal}`
        : null,
    teamResult:
      round.phase === 'RESULT' && round.result && team
        ? round.result.winner === team
          ? '우리 팀 승리'
          : '우리 팀 패배'
        : null,
    title:
      round.phase === 'ABORTED'
        ? '경기 무효'
        : round.phase === 'RESULT'
          ? round.result?.winner === 'runners'
            ? '도망자 승리'
            : round.result?.winner === 'taggers'
              ? '술래 승리'
              : '결과 확인 중'
          : self?.status === 'ESCAPED'
            ? '탈출 성공'
            : self?.status === 'CAPTURED'
              ? '포획되었습니다'
              : '결과 대기',
    message: round.abortReason
      ? ABORT_LABELS[round.abortReason]
      : round.phase === 'ABORTED'
        ? '경기를 계속할 수 없어 무효 처리되었습니다. 연결 정리가 끝나면 방장이 다시 시작할 수 있습니다.'
        : ended
          ? reason === 'two-escaped'
            ? '도망자 2명이 탈출하여 도망자 팀이 승리했습니다.'
            : reason === 'two-captured'
              ? '도망자 2명을 포획하여 술래 팀이 승리했습니다.'
              : reason === 'timeout'
                ? round.result?.winner === 'runners'
                  ? '제한 시간이 끝났고 탈출이 포획보다 많아 도망자 팀이 승리했습니다.'
                  : '제한 시간이 끝나 술래 팀이 승리했습니다.'
                : '최종 결과를 확인하고 있습니다.'
          : '참가가 종료되었습니다. 경기가 끝날 때까지 팀의 공개 결과를 확인할 수 있습니다.',
    counts: {
      ...round.counts,
      active: Math.max(0, runners - round.counts.escaped - round.counts.captured),
    },
    remaining:
      ended || round.deadlineTick === null
        ? null
        : Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20)),
  };
}
