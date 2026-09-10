import { useCallback, useEffect, useRef, useState } from 'react';
import { requestSession, joinProductRoom, productRoomPort } from '../features/room/product-session';
import { LobbyScreen } from '../features/room/LobbyScreen';
import { DeviceCheckScreen } from '../features/game/flow/DeviceCheckScreen';
import { ConnectionLostScreen } from '../features/game/flow/ConnectionLostScreen';
import { LoadingOverlay } from '../features/game/flow/LoadingOverlay';
import { ResultScreen } from '../features/game/flow/ResultScreen';
import { QualityControl } from '../features/game/flow/QualityControl';
import { MiniMap } from '../features/game/map/MiniMap';
import { EquipmentHud } from '../features/game/equipment/EquipmentHud';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { bindProductRoom, type ProductSnapshot } from './product-runtime';

export function ProductApp({ invitation }: { invitation: string }) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [createRoom, setCreateRoom] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null);
  const [selfId, setSelfId] = useState('');
  const [code, setCode] = useState('');
  const [clockTime, setClockTime] = useState<number | null>(null);
  const runtime = useRef<ReturnType<typeof bindProductRoom> | null>(null);
  const generation = useRef(0);
  const preview = useCallback(
    (element: HTMLDivElement | null) => runtime.current?.setPreviewHost(element),
    [],
  );
  const leave = useCallback(async () => {
    generation.current++;
    const old = runtime.current;
    runtime.current = null;
    setJoining(false);
    setSnapshot(null);
    await old
      ?.leave()
      .catch(() => setError('연결 정리를 확인하지 못했습니다. 페이지를 새로고침해 주세요.'));
  }, []);
  useEffect(() => {
    const active = () =>
      runtime.current?.setPageActive(document.visibilityState === 'visible' && document.hasFocus());
    const blur = () => runtime.current?.setPageActive(false);
    const pagehide = () => {
      void leave();
    };
    document.addEventListener('visibilitychange', active);
    window.addEventListener('focus', active);
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', pagehide);
    const timer = window.setInterval(() => {
      runtime.current?.poll();
      const value = runtime.current?.serverNow();
      if (value !== undefined) setClockTime(value);
    }, 100);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', active);
      window.removeEventListener('focus', active);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', pagehide);
      generation.current++;
      const old = runtime.current;
      runtime.current = null;
      void old?.leave().catch(() => {});
    };
  }, [leave]);
  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (joining || runtime.current) return;
    const run = ++generation.current;
    setJoining(true);
    setError('');
    let joined: Awaited<ReturnType<typeof joinProductRoom>> | null = null;
    try {
      const base = { nickname: nickname.trim(), inviteToken: invitation };
      const session = await requestSession(
        createRoom
          ? { ...base, createRoom: true }
          : { ...base, createRoom: false, roomCode: roomCode.trim().toUpperCase() },
      );
      if (run !== generation.current) return;
      const room = await joinProductRoom(session);
      joined = room;
      if (run !== generation.current) {
        await room.leave();
        return;
      }
      runtime.current = bindProductRoom(productRoomPort(room), session, {
        now: () => performance.now(),
        uuid: () => crypto.randomUUID(),
        changed: (value) => {
          if (run === generation.current) setSnapshot(value);
        },
      });
      runtime.current.setPageActive(document.visibilityState === 'visible' && document.hasFocus());
      setSelfId(session.playerId);
      setCode(session.roomCode);
    } catch (cause) {
      if (joined)
        await productRoomPort(joined)
          .leave()
          .catch(() => {});
      if (run === generation.current) {
        runtime.current = null;
        setSnapshot(null);
        const labels: Record<string, string> = {
          INVALID_REQUEST: '닉네임·초대 링크·방 코드를 확인해 주세요.',
          INVALID_INVITATION: '유효한 초대 링크가 필요합니다.',
          CAPACITY: '방이 가득 찼습니다.',
          ROOM_NOT_AVAILABLE: '입장할 수 없는 방입니다.',
          RATE_LIMITED: '잠시 기다린 뒤 다시 시도해 주세요.',
          ADMISSION_CLOSED: '지금은 입장을 받고 있지 않습니다.',
        };
        setError(
          labels[cause instanceof Error ? cause.message : ''] ??
            '연결할 수 없습니다. 로그인과 네트워크 상태를 확인해 주세요.',
        );
      }
    } finally {
      if (run === generation.current) setJoining(false);
    }
  }
  const round = snapshot?.round;
  const view = snapshot?.view;
  const ended = snapshot?.endedSelf ?? (view?.self?.status !== 'ACTIVE' ? view?.self : null);
  const inResult = !!round && (!!ended || ['RESULT', 'ABORTED'].includes(round.phase));
  const worldVisible =
    !!round &&
    !inResult &&
    ['PLAYING', 'TEAM_PRACTICE'].includes(round.phase) &&
    view?.self?.status === 'ACTIVE';
  return (
    <main className="product-shell">
      <header>
        <h1>까꿍</h1>
        {snapshot && (
          <button className="quiet" onClick={() => void leave()}>
            나가기
          </button>
        )}
      </header>
      {!snapshot ? (
        <section className="admission">
          <h2>흑백 미로에서 만나요.</h2>
          <p>
            세 명의 도망자, 세 명의 술래.
            <br />
            초대받은 친구들과 함께 시작하세요.
          </p>
          <form onSubmit={(event) => void join(event)}>
            <label htmlFor="product-nickname">닉네임</label>
            <input
              id="product-nickname"
              autoComplete="off"
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={joining}
              required
            />
            <fieldset disabled={joining}>
              <legend>입장 방법</legend>
              <label>
                <input type="radio" checked={createRoom} onChange={() => setCreateRoom(true)} /> 새
                방 만들기
              </label>
              <label>
                <input type="radio" checked={!createRoom} onChange={() => setCreateRoom(false)} />{' '}
                친구 방 참가
              </label>
            </fieldset>
            {!createRoom && (
              <>
                <label htmlFor="room-code">방 코드</label>
                <input
                  id="room-code"
                  value={roomCode}
                  maxLength={6}
                  onChange={(e) => setRoomCode(e.target.value)}
                  required
                  disabled={joining}
                />
              </>
            )}
            <button disabled={joining || !invitation}>
              {joining ? '입장 중…' : createRoom ? '방 만들기' : '방 참가'}
            </button>
            {joining && (
              <button type="button" className="quiet" onClick={() => void leave()}>
                입장 취소
              </button>
            )}
          </form>
          {!invitation && <p className="notice">유효한 초대 링크로 열어 주세요.</p>}
        </section>
      ) : snapshot.lost ? (
        <ConnectionLostScreen onLeave={() => void leave()} />
      ) : (
        <>
          <QualityControl
            value={snapshot.quality}
            onChange={(value) => runtime.current?.quality(value)}
          />
          {snapshot.roster && round && ['LOBBY', 'DEVICE_CHECK'].includes(round.phase) && (
            <LobbyScreen roster={snapshot.roster} selfId={selfId} roomCode={code} />
          )}
          {round?.phase === 'DEVICE_CHECK' && (
            <DeviceCheckScreen
              status={snapshot.devices}
              ready={snapshot.roster?.players.find((p) => p.playerId === selfId)?.ready ?? false}
              previewHost={preview}
              onStart={async (microphone) => {
                await runtime.current?.startDevices(microphone);
              }}
              onReady={(value) => runtime.current?.ready(value)}
            />
          )}
          {round && inResult && (
            <ResultScreen
              round={round}
              self={ended ?? null}
              host={snapshot.roster?.hostId === selfId}
              onRematch={(mode) => runtime.current?.send({ type: 'REMATCH', payload: { mode } })}
            />
          )}
          {round &&
            !inResult &&
            ['MAP_FINALIZING', 'GAME_LOADING', 'COUNTDOWN'].includes(round.phase) && (
              <LoadingOverlay round={round} serverNow={clockTime} />
            )}
          {worldVisible && view && (
            <EquipmentHud
              view={view}
              tick={runtime.current?.renderTick() ?? round?.serverTick ?? 0}
              selected={snapshot.interaction.selectedEquipment}
              request={snapshot.requests.INSTALL}
              onSelect={(kind) => runtime.current?.selectEquipment(kind)}
              send={(command) => runtime.current?.send(command)}
            />
          )}
          {worldVisible && view && (
            <section className="product-stage">
              <div className="product-canvas">
                <WorldCanvas
                  view={view}
                  ownerNames={Object.fromEntries(
                    snapshot.roster?.players.map((p) => [p.playerId, p.nickname]) ?? [],
                  )}
                  quality={snapshot.quality}
                  renderTick={() => runtime.current?.renderTick() ?? null}
                />
              </div>
              <MiniMap
                view={view}
                ownerNames={Object.fromEntries(
                  snapshot.roster?.players.map((p) => [p.playerId, p.nickname]) ?? [],
                )}
              />
            </section>
          )}
          {worldVisible && round && (
            <p className="game-counts">
              남은 시간{' '}
              {round.deadlineTick === null
                ? '확인 중'
                : `${Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20))}초`}{' '}
              · 탈출 {round.counts.escaped} · 포획 {round.counts.captured}
            </p>
          )}
          {snapshot.request && !['pending', 'applied'].includes(snapshot.request.status) && (
            <p role="status">
              {snapshot.request.status === 'waiting-view'
                ? '서버 화면을 확인하고 있습니다.'
                : snapshot.request.status === 'unconfirmed'
                  ? '요청 결과를 확인하지 못했습니다. 상태를 확인한 뒤 다시 선택해 주세요.'
                  : `요청이 처리되지 않았습니다. (${snapshot.request.code ?? 'CANCELED'})`}
            </p>
          )}
          {snapshot.error && <p role="alert">{snapshot.error}</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
