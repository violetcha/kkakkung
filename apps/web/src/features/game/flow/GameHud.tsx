import type { ActiveSelf, PublicRoundState } from '@kkakkung/protocol/game-schema';

/**
 * 활성 플레이어의 상태 문구. 279 이후 화면에는 핫바·십자선·미니맵이 같은 정보를 보여 주고
 * 이 컴포넌트는 접근성 레이어에만 남는다. 관전은 화면에 보여야 하므로 `SpectatorBar` 가
 * 무대 위에서 따로 맡는다(320).
 */
export function GameHud({
  round,
  self,
  mode,
}: {
  round: PublicRoundState;
  self?: ActiveSelf;
  mode?: 'motion' | 'keyboard';
}) {
  if (!self) return null;
  const practice = round.phase === 'TEAM_PRACTICE';
  const remaining =
    round.deadlineTick === null
      ? null
      : Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20));
  const seconds = (until: number | null) =>
    until === null ? null : Math.max(0, Math.ceil((until - round.serverTick) / 20));
  const restraintSeconds = seconds(self.restraintUntilTick);
  const immuneSeconds = seconds(self.restraintImmuneUntilTick);
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
              ? '데모 진행'
              : `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`}
        </strong>
      </div>
      <p>
        {self.role === 'runner'
          ? '팀원 2명이 각자의 출구로 탈출하면 승리'
          : // S15P21C204-342. 데모 라운드는 시간 초과로 끝나지 않는다(316).
            remaining === null
            ? '도망자 2명을 포획하면 승리 · 제한시간 없음'
            : '도망자 2명을 포획하거나 시간을 버티면 승리'}
      </p>
      <div className="hud-status">
        <span className="hud-outcomes">
          <span data-outcome="escape">◇ 탈출 {round.counts.escaped}/2</span>
          <span data-outcome="capture">◆ 포획 {round.counts.captured}/2</span>
          {/* S15P21C204-276. 구속·면역도 같은 상태 줄에 둔다. 별도 오버레이로 띄우지 않는다. */}
          {restraintSeconds !== null && (
            <span data-outcome="restraint">
              ⛓ {restraintSeconds > 0 ? `구속 ${restraintSeconds}초` : '해제 확인 중'}
            </span>
          )}
          {immuneSeconds !== null && (
            <span data-outcome="immune">
              ◈ {immuneSeconds > 0 ? `면역 ${immuneSeconds}초` : '면역 종료 확인 중'}
            </span>
          )}
        </span>
        <span data-state={state}>
          {mode === 'motion' ? '얼굴·상체 조작' : '키보드 조작'} · {condition}
        </span>
      </div>
    </section>
  );
}
