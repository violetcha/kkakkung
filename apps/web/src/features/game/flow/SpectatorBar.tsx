import type { SpectateView } from '@kkakkung/protocol/game-schema';

/**
 * S15P21C204-320. 포획된 도망자가 누구의 눈으로 보고 있는지와, 다른 생존자로 옮기는 버튼.
 *
 * 279 에서 경기 화면이 풀스크린 3D 가 되면서 `GameHud` 가 접근성 전용 컨테이너로 들어갔다.
 * 활성 플레이어는 핫바·십자선·미니맵·이벤트 기록이 같은 정보를 화면에 다시 보여 주므로
 * 괜찮았지만, 관전 UI 는 시각적 대체물이 없어 이름도 버튼도 보이지 않고 1px 로 잘려 눌리지도
 * 않았다. 그래서 관전만 무대 위 오버레이로 따로 올린다.
 *
 * 관전자에게는 핫바·십자선·얼굴 안내·HUD 서랍이 모두 그려지지 않으므로 아래 가운데가 비어
 * 있다. 활성 플레이어의 핫바와 같은 자리다.
 */
export function SpectatorBar({
  spectating,
  playerNames = {},
  onSpectate,
}: {
  spectating: SpectateView;
  playerNames?: Readonly<Record<string, string>>;
  onSpectate?(targetPlayerId: string): void;
}) {
  // 로스터가 아직 없으면 이름을 모른다. 그때도 후보끼리는 구분돼야 하므로 순번을 붙인다.
  const nameOf = (playerId: string) => {
    const known = playerNames[playerId];
    if (known) return known;
    const index = spectating.candidates.indexOf(playerId);
    return index >= 0 ? `도망자 ${index + 1}` : '생존 도망자';
  };
  return (
    <section className="spectator-bar" aria-label="관전 상태">
      {/* key 가 대상이라 시점이 바뀔 때마다 이 줄이 다시 마운트되어 등장 표시가 한 번 더 돈다. */}
      <p className="spectator-now" key={spectating.targetId} aria-live="polite">
        <span className="role-badge">관전</span>
        {/* 이름과 "시점" 이 줄 사이에서 갈라지면 누구인지 읽기 어렵다. 한 덩어리로 둔다. */}
        <span className="spectator-target-name">
          <strong>{nameOf(spectating.targetId)}</strong> 시점
        </span>
      </p>
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
            {nameOf(playerId)}
          </button>
        ))}
      </div>
      <p className="spectator-note">생존 도망자가 보고 듣는 범위만 함께 봅니다.</p>
    </section>
  );
}
