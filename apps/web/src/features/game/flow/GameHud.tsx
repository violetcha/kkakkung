import type { ActiveSelf, PublicRoundState, SpectateView } from '@kkakkung/protocol/game-schema';

export function GameHud({
  round,
  self,
  mode,
  spectating,
  playerNames = {},
  onSpectate,
}: {
  round: PublicRoundState;
  self?: ActiveSelf;
  mode?: 'motion' | 'keyboard';
  spectating?: SpectateView;
  playerNames?: Readonly<Record<string, string>>;
  onSpectate?(targetPlayerId: string): void;
}) {
  if (spectating) {
    const targetName = playerNames[spectating.targetId] ?? '생존 도망자';
    return (
      <section className="game-hud spectator-hud" aria-label="관전 상태">
        <div>
          <span className="role-badge">관전</span>
          <strong>관전 중 · {targetName} 시점</strong>
        </div>
        <p>생존 도망자가 보고 듣는 범위만 함께 봅니다.</p>
        <div className="spectator-targets" aria-label="관전 대상 선택">
          {spectating.candidates.map((playerId) => (
            <button
              key={playerId}
              type="button"
              data-spectate-target={playerId}
              aria-pressed={playerId === spectating.targetId}
              disabled={playerId === spectating.targetId}
              onClick={() => onSpectate?.(playerId)}
            >
              {playerNames[playerId] ?? '도망자'}
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (!self) return null;
  const practice = round.phase === 'TEAM_PRACTICE';
  const remaining =
    round.deadlineTick === null
      ? null
      : Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20));
  // 상태는 문구와 data-state를 함께 쓰고 색만으로 전달하지 않는다(V4).
  const [state, condition] =
    self.restraintUntilTick !== null && round.serverTick < self.restraintUntilTick
      ? (['restrained', '구속 중 · 풀릴 때까지 기다리세요'] as const)
      : self.challenge
        ? (['challenge', '탈출 동작 진행 중'] as const)
        : self.installation
          ? (['installing', '장비 설치 중'] as const)
          : self.action?.kind === 'turn'
            ? (['turning', '회전 중'] as const)
            : self.action
              ? (['moving', '이동 중'] as const)
              : (['ready', '행동 가능'] as const);
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
        <span className="hud-outcomes">
          <span data-outcome="escape">◇ 탈출 {round.counts.escaped}/2</span>
          <span data-outcome="capture">◆ 포획 {round.counts.captured}/2</span>
        </span>
        <span data-state={state}>
          {mode === 'motion' ? '얼굴·상체 조작' : '키보드 조작'} · {condition}
        </span>
      </div>
    </section>
  );
}
