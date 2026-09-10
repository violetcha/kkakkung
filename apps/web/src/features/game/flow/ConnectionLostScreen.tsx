export function ConnectionLostScreen({ onLeave }: { onLeave(): void }) {
  return (
    <section role="alert">
      <h2>게임 연결이 끊겼습니다</h2>
      <p>진행 중인 경기는 복원할 수 없습니다. 새 초대로 다시 입장해 주세요.</p>
      <button onClick={onLeave}>입장 화면으로</button>
    </section>
  );
}
