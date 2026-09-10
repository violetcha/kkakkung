import type { RoomRosterMessage } from '@kkakkung/protocol/game-messages';
export function LobbyScreen({
  roster,
  selfId,
  roomCode,
}: {
  roster: RoomRosterMessage;
  selfId: string;
  roomCode: string;
}) {
  return (
    <section className="lobby">
      <h2>친구들을 기다리는 중</h2>
      <p>
        방 코드 <strong>{roomCode}</strong> · {roster.players.length}/6
      </p>
      <ol>
        {Array.from({ length: 6 }, (_, index) => {
          const player = roster.players[index];
          return (
            <li key={player?.playerId ?? index}>
              <span>{player?.nickname ?? '빈 자리'}</span>
              {player && (
                <span>
                  {player.playerId === selfId ? '나 · ' : ''}
                  {player.playerId === roster.hostId ? '방장 · ' : ''}
                  {!player.connected ? '연결 끊김' : player.ready ? '준비 완료' : '준비 중'}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="notice">
        게임 중 얼굴 영상이 화면에 나타나기 전에 기기로 수신될 수 있습니다. 서비스는 녹화 기능을
        제공하지 않습니다.
      </p>
    </section>
  );
}
