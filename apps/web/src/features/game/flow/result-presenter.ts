import type { PrivateView, PublicRoundState, AbortReason } from '@kkakkung/protocol/game-schema';
const ABORT_LABELS: Record<AbortReason, string> = {
  GAME_CONNECTION_LOST: '게임 연결이 끊겨 경기가 무효 처리되었습니다.',
  SERVER_TICK_OVERLOAD: '서버 지연으로 경기가 무효 처리되었습니다.',
  MEDIA_POLICY_UNCERTAIN: '미디어 권한을 확인하지 못해 경기가 무효 처리되었습니다.',
  MEDIA_UNAVAILABLE: '미디어 연결을 사용할 수 없어 경기가 무효 처리되었습니다.',
};
export function resultPresenter(round: PublicRoundState, self: PrivateView['self']) {
  return {
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
      : '경기가 끝날 때까지 공개 결과를 확인할 수 있습니다.',
    counts: {
      ...round.counts,
      active: Math.max(0, 3 - round.counts.escaped - round.counts.captured),
    },
    remaining:
      round.deadlineTick === null
        ? null
        : Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20)),
  };
}
