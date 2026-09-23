export function ConnectionLostScreen({
  onLeave,
  expired = false,
  removed = false,
  showcaseClosed = false,
  showcase = false,
  roomCode = null,
}: {
  onLeave(): void;
  /**
   * S15P21C204-370. 끊긴 방의 코드. 방장이 로비로 돌아가면 이 코드로 다시 들어올 수 있으므로
   * 알려 준다. 시연·만료·내보냄에는 돌아갈 방이 없어 쓰지 않는다.
   */
  roomCode?: string | null;
  expired?: boolean;
  removed?: boolean;
  /** S15P21C204-363. 시연 방의 방장이 나가 방이 닫혔다. */
  showcaseClosed?: boolean;
  /** 시연 세션이다. 돌아갈 곳은 입장 폼이 아니라 `/showcase` 첫 화면이다. */
  showcase?: boolean;
}) {
  // 시연 방은 잠시 안내를 보인 뒤 페이지가 /showcase 로 돌려보낸다. 단추는 기다리기 싫은 사람 몫이다.
  const destination = showcase ? '시연 입장 화면으로' : '입장 화면으로';
  return (
    <section role="alert">
      <h2>
        {showcaseClosed
          ? '시연이 종료되었습니다'
          : removed
            ? '방장이 대기방에서 내보냈습니다'
            : expired
              ? '방의 대기 시간이 끝났습니다'
              : '게임 연결이 끊겼습니다'}
      </h2>
      <p>
        {showcaseClosed
          ? '방장이 시연 방을 나가 방을 닫았습니다. 잠시 뒤 시연 입장 화면으로 돌아갑니다.'
          : removed
            ? '이 방의 참가가 종료됐습니다. 입장 화면으로 돌아가 새 방을 만들거나 친구에게 다시 초대를 요청해 주세요.'
            : expired
              ? `사용하지 않는 방을 정리했습니다. ${showcase ? '시연 입장 화면에서 다시 들어와 주세요.' : '입장 화면에서 새 방을 만들거나 참가해 주세요.'}`
              : showcase
                ? '진행 중인 경기는 복원할 수 없습니다. 시연 입장 화면에서 다시 들어와 주세요.'
                : roomCode
                  ? `진행 중인 경기는 복원할 수 없습니다. 방장이 로비로 돌아가면 방 코드 ${roomCode}로 다시 참가할 수 있습니다.`
                  : '진행 중인 경기는 복원할 수 없습니다. 입장 화면에서 다시 참가해 주세요.'}
      </p>
      <button onClick={onLeave}>{destination}</button>
    </section>
  );
}
