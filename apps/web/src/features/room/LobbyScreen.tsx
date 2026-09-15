import { useState } from 'react';
import type { RoomAccessMessage, RoomRosterMessage } from '@kkakkung/protocol/game-messages';
import type { RequestDisplay } from './command-lifecycle';
import { commandFeedback } from '../game/flow/command-feedback';
import { PRIVACY_NOTICE } from './privacy-notice';
export function LobbyScreen({
  roster,
  selfId,
  roomCode,
  access,
  lockRequest,
  kickRequest,
  onLock,
  onKick,
}: {
  roster: RoomRosterMessage;
  selfId: string;
  roomCode: string;
  access?: RoomAccessMessage | null;
  lockRequest?: RequestDisplay;
  kickRequest?: RequestDisplay;
  onLock?(locked: boolean): void;
  onKick?(targetPlayerId: string): void;
}) {
  const [removalId, setRemovalId] = useState<string | null>(null);
  const host = roster.hostId === selfId;
  const busy = [lockRequest, kickRequest].some(
    (request) => request && ['pending', 'waiting-view'].includes(request.status),
  );
  const removal = roster.players.find(
    (player) => player.playerId === removalId && player.connected,
  );
  const currentAccess = access?.matchId === roster.matchId ? access : null;
  return (
    <section className="lobby">
      <h2>친구들을 기다리는 중</h2>
      <p>
        방 코드 <strong>{roomCode}</strong> · {roster.players.length}/6
      </p>
      <p role="status">
        {currentAccess
          ? currentAccess.locked
            ? '새 참가자 입장 잠김'
            : '새 참가자 입장 가능'
          : '입장 상태 확인 중'}
      </p>
      {host && onLock && (
        <button disabled={busy || !currentAccess} onClick={() => onLock(!currentAccess?.locked)}>
          {currentAccess?.locked ? '입장 잠금 해제' : '입장 잠그기'}
        </button>
      )}
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
              {host && onKick && player?.connected && player.playerId !== selfId && (
                <button
                  disabled={busy || !currentAccess}
                  onClick={() => setRemovalId(player.playerId)}
                >
                  {player.nickname} 내보내기
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {host && removal && onKick && (
        <div role="group" aria-label="참가자 내보내기 확인">
          <p>
            {removal.nickname}님을 내보내면 새 참가자 입장도 잠깁니다. 다시 받으려면 잠금을 해제해
            주세요.
          </p>
          <button
            disabled={busy || !currentAccess}
            onClick={() => {
              onKick(removal.playerId);
              setRemovalId(null);
            }}
          >
            내보내기 확인
          </button>
          <button onClick={() => setRemovalId(null)}>취소</button>
        </div>
      )}
      {busy && <p role="status">방 관리를 처리하고 있습니다.</p>}
      {[lockRequest, kickRequest].map((request, index) =>
        commandFeedback(request) ? (
          <p role="status" key={index}>
            {commandFeedback(request)}
          </p>
        ) : null,
      )}
      <ul className="notice" aria-label="개인정보 처리 안내">
        {PRIVACY_NOTICE.map((sentence) => (
          <li key={sentence.text}>{sentence.text}</li>
        ))}
      </ul>
    </section>
  );
}
