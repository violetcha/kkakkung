// S15P21C204-295. 대기실 한 화면. 복도 안쪽을 배경으로, 왼쪽에 할 일(준비·맵·설정·나가기)이
// 세로로 서고 아래에 참가자 카드가 한 줄로 선다. 준비를 누르는 순간 카메라가 켜지므로 그때부터
// 얼굴이 기본 얼굴에서 실제 가공 얼굴로 바뀐다. 방 관리(잠금·내보내기)는 맵 칸 안에 접어 둔다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RoomAccessMessage, RoomRosterMessage } from '@kkakkung/protocol/game-messages';
import type { Texture } from 'three';
import type { RequestDisplay } from './command-lifecycle';
import { commandFeedback } from '../game/flow/command-feedback';
import { MapSizeChoice } from './MapSizeChoice';
import { PRIVACY_NOTICE } from './privacy-notice';
import { PlayerTileView } from './PlayerTileView';
import { DEFAULT_MAP_SIZE, type MapSizeId } from './map-size';

export type LobbyDevice = Readonly<{ label: string; state: string }>;

/** 자리 수를 명부가 알려 주지 않는 옛 서버를 위한 기본값. 시연 방은 네 자리다. */
const DEFAULT_SEATS = 6;
const clock = (at: number) =>
  new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

type LogLine = Readonly<{ id: string; at: number; text: string }>;

/**
 * 방에서 일어난 일을 몇 줄로 남긴다. 서버는 지난 일을 보내지 않으므로 내가 들어온 뒤의 명부
 * 변화만 적는다. 기록이 아니라 지금 무슨 일이 있었는지 보여 주는 줄이다.
 */
function useRoomLog(roster: RoomRosterMessage) {
  const [lines, setLines] = useState<readonly LogLine[]>([]);
  const previous = useRef<RoomRosterMessage | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = roster;
    const at = Date.now();
    const next: LogLine[] = [];
    const add = (key: string, text: string) =>
      next.push({ id: `${key}:${roster.stateVersion}`, at, text });
    if (!before) {
      for (const player of roster.players)
        add(`present:${player.playerId}`, `${player.nickname} 님이 대기실에 있습니다.`);
    } else {
      for (const player of roster.players) {
        const old = before.players.find((item) => item.playerId === player.playerId);
        if (!old) add(`join:${player.playerId}`, `${player.nickname} 님이 입장했습니다.`);
        else if (old.connected && !player.connected)
          add(`lost:${player.playerId}`, `${player.nickname} 님의 연결이 끊겼습니다.`);
        else if (!old.connected && player.connected)
          add(`back:${player.playerId}`, `${player.nickname} 님이 돌아왔습니다.`);
        else if (!old.ready && player.ready)
          add(`ready:${player.playerId}`, `${player.nickname} 님이 준비를 마쳤습니다.`);
      }
      for (const player of before.players)
        if (!roster.players.some((item) => item.playerId === player.playerId))
          add(`left:${player.playerId}`, `${player.nickname} 님이 나갔습니다.`);
    }
    if (!next.length) return;
    setLines((current) => [...current, ...next].slice(-6));
  }, [roster]);
  return lines;
}

export function LobbyScreen({
  roster,
  selfId,
  roomCode,
  access,
  lockRequest,
  kickRequest,
  onLock,
  onKick,
  mapSize = DEFAULT_MAP_SIZE,
  canChooseMapSize = false,
  mapSizeRequest,
  onSelectMapSize,
  mapSizeNote,
  ready = false,
  canReady = false,
  readyHint,
  onReady,
  onStart,
  startRequest,
  devices,
  faceOf,
  pumpHost,
  onSettings,
  onLeave,
  invite,
}: {
  roster: RoomRosterMessage;
  selfId: string;
  roomCode: string;
  access?: RoomAccessMessage | null;
  lockRequest?: RequestDisplay;
  kickRequest?: RequestDisplay;
  onLock?(locked: boolean): void;
  onKick?(targetPlayerId: string): void;
  /** 방이 고른 맵 크기. 서버가 방마다 맵을 갖기 전까지는 화면에서만 유지된다. */
  mapSize?: MapSizeId;
  /** 방장이고 아직 바꿀 수 있는 단계(LOBBY)일 때만 true. */
  canChooseMapSize?: boolean;
  mapSizeRequest?: RequestDisplay;
  onSelectMapSize?(size: MapSizeId): void;
  mapSizeNote?: string;
  /** 내 준비 상태. 서버 명부가 원본이다. */
  ready?: boolean;
  /** 여섯 명이 모여 준비를 받을 수 있는 단계인지. */
  canReady?: boolean;
  /** 아직 누를 수 없을 때 그 이유 한 줄. */
  readyHint?: string;
  /** 누르면 카메라를 켜고 준비를 보고한다. */
  onReady?(next: boolean): void;
  /** 여섯 명이 다 준비했을 때 방장이 누른다. 그때까지 경기는 시작되지 않는다. */
  onStart?(): void;
  startRequest?: RequestDisplay;
  /** 내 장치 상태 줄. 준비를 누른 뒤에만 채워 보낸다. */
  devices?: readonly LobbyDevice[];
  /** 그 사람의 가공 얼굴. 없으면 기본 얼굴로 선다. */
  faceOf?(playerId: string): Texture | null;
  /**
   * 내 카메라 미리보기를 받을 자리. 내 칸 안에 1픽셀로 들어간다(화면에는 보이지 않는다).
   * 재생 중인 미리보기가 문서 안에 남아 있어야 얼굴 표본이 끊기지 않는다.
   */
  pumpHost?(element: HTMLDivElement | null): void;
  /** 방 안 설정 창을 연다. */
  onSettings?(): void;
  /** 방을 나간다. */
  onLeave?(): void;
  /** 초대 링크 만들기 화면. 방장에게만 온다. */
  invite?: ReactNode;
}) {
  const [removalId, setRemovalId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'map' | 'invite'>('none');
  const [copied, setCopied] = useState(false);
  const copyCode = () => {
    void navigator.clipboard
      ?.writeText(roomCode)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const host = roster.hostId === selfId;
  // 시연 방(showcase)은 네 명이 2:2 로 뛰고 맵이 고정이다. 자리 수는 명부가 알려 준다.
  const seats = roster.capacity ?? DEFAULT_SEATS;
  const showcase = roster.kind === 'showcase';
  const busy = [lockRequest, kickRequest, mapSizeRequest].some(
    (request) => request && ['pending', 'waiting-view'].includes(request.status),
  );
  const removal = roster.players.find(
    (player) => player.playerId === removalId && player.connected,
  );
  const currentAccess = access?.matchId === roster.matchId ? access : null;
  const readyCount = roster.players.filter((player) => player.ready).length;
  // 여섯 자리가 다 차고 모두 준비했을 때만 방장의 시작 단추가 선다.
  const everyoneReady =
    roster.players.length === seats &&
    roster.players.every((player) => player.connected && player.ready);
  const starting = startRequest && ['pending', 'waiting-view'].includes(startRequest.status);
  const log = useRoomLog(roster);
  const firstEmpty = roster.players.length;
  return (
    <section className="lobby">
      <div className="lobby-head">
        <p className="pause-eyebrow">대기실</p>
        <h2>{showcase ? '시연 참가자를 기다리는 중' : '친구들을 기다리는 중입니다.'}</h2>
      </div>
      <div className="lobby-code">
        <p className="pause-eyebrow">방 코드</p>
        <p className="lobby-code-value">
          <span>{roomCode}</span>
          <button
            type="button"
            className="lobby-code-copy"
            onClick={copyCode}
            aria-label={copied ? '방 코드를 복사했습니다' : '방 코드 복사'}
            title={copied ? '복사됨' : '방 코드 복사'}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              {copied ? (
                <path d="M2.5 8.5 6 12l7.5-8" fill="none" stroke="currentColor" strokeWidth="1.6" />
              ) : (
                <>
                  <rect x="2.5" y="2.5" width="8" height="10" fill="none" stroke="currentColor" />
                  <rect x="5.5" y="5.5" width="8" height="10" fill="none" stroke="currentColor" />
                </>
              )}
            </svg>
          </button>
        </p>
        <p className="lobby-code-count">
          {roster.players.length}/{seats} | 준비 {readyCount}/{seats}
        </p>
      </div>
      <div className="lobby-side">
        <nav className="lobby-menu" aria-label="대기실">
          <button
            type="button"
            className="lobby-ready"
            aria-pressed={ready}
            disabled={!canReady || !onReady}
            onClick={() => onReady?.(!ready)}
          >
            {ready ? '준비 취소' : '준비하기'}
          </button>
          {everyoneReady && host && (
            <button
              type="button"
              className="lobby-start"
              disabled={!onStart || starting}
              onClick={() => onStart?.()}
            >
              {starting ? '시작하는 중…' : '게임 시작'}
            </button>
          )}
          <button
            type="button"
            aria-expanded={panel === 'map'}
            onClick={() => setPanel(panel === 'map' ? 'none' : 'map')}
          >
            맵 정보
          </button>
          {onLeave && (
            <button type="button" onClick={onLeave}>
              나가기
            </button>
          )}
        </nav>
        <p className="lobby-note">
          {everyoneReady
            ? host
              ? '여섯 명이 모두 준비했어요. 시작을 누르면 팀 연습으로 넘어갑니다.'
              : '여섯 명이 모두 준비했어요. 방장이 시작하기를 기다리는 중입니다.'
            : ready
              ? '준비 완료. 여섯 명이 모두 준비하면 방장이 시작합니다.'
              : (readyHint ??
                '준비를 누르면 카메라가 켜지고 자세 점검 창이 열려요. 점검을 마치면 준비 완료입니다.')}
        </p>
      </div>
      {panel === 'none' && (
        <p className="lobby-door" aria-hidden="true">
          내 출구
        </p>
      )}
      <div className="lobby-panel" aria-label="맵과 방 관리" hidden={panel !== 'map'}>
        <MapSizeChoice
          value={showcase ? 'small' : mapSize}
          canEdit={host && canChooseMapSize && !showcase}
          busy={busy}
          onSelect={onSelectMapSize}
          {...(mapSizeNote ? { editableNote: mapSizeNote } : {})}
          {...(showcase ? { note: '시연 맵은 16x16으로 고정되어 있습니다.' } : {})}
        />
        {ready && devices && devices.length > 0 && (
          <dl className="settings-rows lobby-devices" aria-label="내 장치 상태">
            {devices.map((device) => (
              <div key={device.label}>
                <dt>{device.label}</dt>
                <dd>{device.state}</dd>
              </div>
            ))}
          </dl>
        )}
        <details className="lobby-notice">
          <summary>개인정보 처리 안내</summary>
          <ul className="notice" aria-label="개인정보 처리 안내">
            {PRIVACY_NOTICE.map((sentence) => (
              <li key={sentence.text}>{sentence.text}</li>
            ))}
          </ul>
        </details>
      </div>
      {/* 맵 칸과 같은 규칙: 항상 자리에 있고 접힘만 바뀐다. */}
      <div className="lobby-panel" aria-label="친구 초대" hidden={panel !== 'invite'}>
        {invite}
        {/* 누구를 더 받을지는 초대와 같은 자리에서 정한다. */}
        <div className="lobby-manage">
          <p role="status">
            {currentAccess
              ? currentAccess.locked
                ? '새 참가자 입장 잠김'
                : '새 참가자 입장 가능'
              : '입장 상태 확인 중'}
          </p>
          {host && onLock && (
            <button
              disabled={busy || !currentAccess}
              onClick={() => onLock(!currentAccess?.locked)}
            >
              {currentAccess?.locked ? '입장 잠금 해제' : '입장 잠그기'}
            </button>
          )}
        </div>
      </div>
      <ol className="lobby-seats" aria-label="참가자">
        {Array.from({ length: seats }, (_, index) => {
          const player = roster.players[index];
          const state = !player
            ? 'empty'
            : !player.connected
              ? 'lost'
              : player.ready
                ? 'ready'
                : 'waiting';
          const inviteSlot = !player && index === firstEmpty && host && invite;
          return (
            <li
              key={player?.playerId ?? `seat-${index}`}
              className="lobby-seat"
              data-state={state}
              data-host={player?.playerId === roster.hostId}
            >
              {player ? (
                <>
                  <div className="lobby-seat-view">
                    {player.playerId === selfId && pumpHost && (
                      <div className="lobby-seat-pump" ref={pumpHost} aria-hidden="true" />
                    )}
                    <PlayerTileView face={faceOf?.(player.playerId)} />
                  </div>
                  {player.playerId === roster.hostId && (
                    <span className="lobby-crown" aria-label="방장">
                      ♛
                    </span>
                  )}
                  <p className="lobby-seat-name">
                    {player.nickname}
                    <span className="lobby-seat-role">
                      {player.playerId === roster.hostId
                        ? '방장'
                        : player.playerId === selfId
                          ? '나'
                          : '\u00a0'}
                    </span>
                  </p>
                  {state === 'ready' ? (
                    <p className="lobby-stamp" role="status">
                      준비 완료
                    </p>
                  ) : (
                    <p className="lobby-seat-state">{state === 'lost' ? '연결 끊김' : '준비 전'}</p>
                  )}
                  {host && onKick && player.connected && player.playerId !== selfId && (
                    <button
                      type="button"
                      className="lobby-kick"
                      disabled={busy || !currentAccess}
                      onClick={() => setRemovalId(player.playerId)}
                    >
                      {player.nickname} 내보내기
                    </button>
                  )}
                </>
              ) : inviteSlot ? (
                <button
                  type="button"
                  className="lobby-invite-slot"
                  aria-expanded={panel === 'invite'}
                  onClick={() => setPanel(panel === 'invite' ? 'none' : 'invite')}
                >
                  <span aria-hidden="true">+</span>
                  참가자 초대
                </button>
              ) : (
                <p className="lobby-seat-state lobby-seat-empty">빈 자리</p>
              )}
            </li>
          );
        })}
      </ol>
      <ul className="lobby-log" aria-label="방 소식">
        {log.map((line) => (
          <li key={line.id}>
            <span>[{clock(line.at)}]</span> {line.text}
          </li>
        ))}
      </ul>
      <footer className="lobby-footer">
        {onSettings && (
          <button type="button" onClick={onSettings}>
            <kbd>ESC</kbd> 설정
          </button>
        )}
      </footer>
      {host && removal && onKick && (
        <div className="lobby-panel" role="group" aria-label="참가자 내보내기 확인">
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
      {[startRequest, lockRequest, kickRequest, mapSizeRequest].map((request, index) =>
        commandFeedback(request) ? (
          <p role="status" key={index}>
            {commandFeedback(request)}
          </p>
        ) : null,
      )}
    </section>
  );
}
