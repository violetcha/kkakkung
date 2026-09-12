export function ConnectionLostScreen({
  onLeave,
  expired = false,
}: {
  onLeave(): void;
  expired?: boolean;
}) {
  return (
    <section role="alert">
      <h2>{expired ? '방의 대기 시간이 끝났습니다' : '게임 연결이 끊겼습니다'}</h2>
      <p>
        {expired
          ? '사용하지 않는 방을 정리했습니다. 입장 화면에서 새 방을 만들거나 참가해 주세요.'
          : '진행 중인 경기는 복원할 수 없습니다. 입장 화면에서 다시 참가해 주세요.'}
      </p>
      <button onClick={onLeave}>입장 화면으로</button>
    </section>
  );
}
