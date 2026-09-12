import type { ActiveSelf, PublicRoundState } from '@kkakkung/protocol/game-schema';

export function GameHud({
  round,
  self,
  mode,
}: {
  round: PublicRoundState;
  self: ActiveSelf;
  mode: 'motion' | 'keyboard';
}) {
  const practice = round.phase === 'TEAM_PRACTICE';
  const remaining =
    round.deadlineTick === null
      ? null
      : Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20));
  const condition =
    self.restraintUntilTick !== null && round.serverTick < self.restraintUntilTick
      ? '구속 중 · 풀릴 때까지 기다리세요'
      : self.challenge
        ? '탈출 동작 진행 중'
        : self.installation
          ? '장비 설치 중'
          : self.action?.kind === 'turn'
            ? '회전 중'
            : self.action
              ? '이동 중'
              : '행동 가능';
  return (
    <section className="game-hud" aria-label="현재 경기 상태">
      <div>
        <span className="role-badge">{self.role === 'runner' ? '도망자' : '술래'}</span>
        <strong>
          {practice
            ? '조작 연습'
            : remaining === null
              ? '시간 확인 중'
              : `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`}
        </strong>
      </div>
      <p>
        {self.role === 'runner'
          ? '팀원 2명이 각자의 출구로 탈출하면 승리'
          : '도망자 2명을 포획하거나 시간을 버티면 승리'}
      </p>
      <div className="hud-status">
        <span>
          탈출 {round.counts.escaped}/2 · 포획 {round.counts.captured}/2
        </span>
        <span>
          {mode === 'motion' ? '얼굴·상체 조작' : '키보드 조작'} · {condition}
        </span>
      </div>
    </section>
  );
}
