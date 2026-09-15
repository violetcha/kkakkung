import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestSession,
  requestSessionAccess,
  joinProductRoom,
  productRoomPort,
  cancelSessionReservation,
} from '../features/room/product-session';
import type { SessionAccessResponse, SessionResponse } from '@kkakkung/protocol/game-messages';
import { LobbyScreen } from '../features/room/LobbyScreen';
import { RoomInvitationControls } from '../features/room/RoomInvitationControls';
import { DeviceCheckScreen } from '../features/game/flow/DeviceCheckScreen';
import { FaceGuidanceNotice } from '../features/game/flow/FaceGuidanceNotice';
import { LocalControls } from '../features/game/flow/LocalControls';
import { AudioControls } from '../features/game/flow/AudioControls';
import type { AudioPreferences } from '../features/media/audio-preferences';
import { ConnectionLostScreen } from '../features/game/flow/ConnectionLostScreen';
import { preparationFeedback } from '../features/game/flow/preparation-feedback';
import { commandFeedback } from '../features/game/flow/command-feedback';
import { LoadingOverlay } from '../features/game/flow/LoadingOverlay';
import { ResultScreen } from '../features/game/flow/ResultScreen';
import { GameHud } from '../features/game/flow/GameHud';
import { QualityControl } from '../features/game/flow/QualityControl';
import { MiniMap } from '../features/game/map/MiniMap';
import { PoseChallenge } from '../features/game/pose/PoseChallenge';
import { KeyChallenge } from '../features/game/pose/KeyChallenge';
import { PracticeScreen } from '../features/game/flow/PracticeScreen';
import { ExchangePanel } from '../features/game/map/ExchangePanel';
import { EquipmentHud } from '../features/game/equipment/EquipmentHud';
import { RestraintHud } from '../features/game/equipment/RestraintHud';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { SoloPracticeScreen } from '../features/game/solo/SoloPracticeScreen';
import { bindProductRoom, type ProductSnapshot } from './product-runtime';
import {
  createRuntimeMetrics,
  metricsRequested,
  publishRuntimeMetrics,
  type RuntimeMetrics,
} from './runtime-metrics';

export function ProductApp({
  invitation,
  initialRoom = '',
}: {
  invitation: string;
  initialRoom?: string;
}) {
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState(initialRoom);
  const [createRoom, setCreateRoom] = useState(!initialRoom);
  const [joining, setJoining] = useState(false);
  const [solo, setSolo] = useState(false);
  const finishSolo = useCallback(() => setSolo(false), []);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<'checking' | SessionAccessResponse['method'] | 'failed'>(
    'checking',
  );
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null);
  const [selfId, setSelfId] = useState('');
  const [code, setCode] = useState('');
  const [sessionCredential, setSessionCredential] = useState<string | null>(null);
  const [clockTime, setClockTime] = useState<number | null>(null);
  const runtime = useRef<ReturnType<typeof bindProductRoom> | null>(null);
  // Measurement is opt-in (?metrics=1). Without the flag nothing is created, so
  // the normal product path neither collects nor exposes anything.
  const metrics = useRef<RuntimeMetrics | null>(null);
  if (metrics.current === null && metricsRequested(window.location.search))
    metrics.current = createRuntimeMetrics({ now: () => performance.now() });
  useEffect(() => {
    const collector = metrics.current;
    if (!collector) return;
    const remove = publishRuntimeMetrics(window as unknown as Record<string, unknown>, collector);
    return () => {
      remove();
      collector.dispose();
    };
  }, []);
  const readSensors = useCallback(() => runtime.current?.sensors ?? null, []);
  const readAudio = useCallback(() => runtime.current?.getLocalAudioStatus() ?? null, []);
  const changeAudio = useCallback(
    (value: AudioPreferences) => runtime.current?.setAudioPreferences(value),
    [],
  );
  const playTestTone = useCallback(
    async () => (await runtime.current?.playTestTone()) ?? 'unavailable',
    [],
  );
  const generation = useRef(0);
  const pendingSession = useRef<SessionResponse | null>(null);
  useEffect(() => {
    let active = true;
    setAccess('checking');
    void requestSessionAccess()
      .then(({ method }) => {
        if (active) setAccess(method);
      })
      .catch(() => {
        if (active) setAccess('failed');
      });
    return () => {
      active = false;
    };
  }, [accessAttempt]);
  const appliedInvitation = useRef({ invitation, initialRoom });
  const cancelPendingAdmission = useCallback(() => {
    const pending = pendingSession.current;
    pendingSession.current = null;
    if (pending) void cancelSessionReservation(pending);
  }, []);
  const preview = useCallback(
    (element: HTMLDivElement | null) => runtime.current?.setPreviewHost(element),
    [],
  );
  const leave = useCallback(async () => {
    generation.current++;
    cancelPendingAdmission();
    const old = runtime.current;
    runtime.current = null;
    setJoining(false);
    setSnapshot(null);
    setSessionCredential(null);
    await old
      ?.leave()
      .catch(() => setError('연결 정리를 확인하지 못했습니다. 페이지를 새로고침해 주세요.'));
  }, [cancelPendingAdmission]);
  useEffect(() => {
    const previous = appliedInvitation.current;
    // Keep a new invitation for the next admission; never evict an active participant.
    if (
      runtime.current ||
      (previous.invitation === invitation && previous.initialRoom === initialRoom)
    )
      return;
    appliedInvitation.current = { invitation, initialRoom };
    generation.current++;
    cancelPendingAdmission();
    setJoining(false);
    setRoomCode(initialRoom);
    setCreateRoom(!initialRoom);
    setError('');
  }, [invitation, initialRoom, snapshot, cancelPendingAdmission]);
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
      cancelPendingAdmission();
      const old = runtime.current;
      runtime.current = null;
      void old?.leave().catch(() => {});
    };
  }, [leave, cancelPendingAdmission]);
  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (joining || runtime.current || solo) return;
    const run = ++generation.current;
    setJoining(true);
    setError('');
    let joined: Awaited<ReturnType<typeof joinProductRoom>> | null = null;
    let session: SessionResponse | null = null;
    try {
      const base = {
        nickname: nickname.trim(),
        ...(invitation ? { inviteToken: invitation } : {}),
      };
      session = await requestSession(
        createRoom
          ? { ...base, createRoom: true }
          : { ...base, createRoom: false, roomCode: roomCode.trim().toUpperCase() },
      );
      if (run !== generation.current) {
        await cancelSessionReservation(session);
        return;
      }
      pendingSession.current = session;
      const room = await joinProductRoom(session);
      joined = room;
      if (pendingSession.current === session) pendingSession.current = null;
      if (run !== generation.current) {
        await room.leave();
        await cancelSessionReservation(session);
        return;
      }
      runtime.current = bindProductRoom(productRoomPort(room), session, {
        now: () => performance.now(),
        uuid: () => crypto.randomUUID(),
        changed: (value) => {
          if (run === generation.current) setSnapshot(value);
        },
        ...(metrics.current ? { metrics: metrics.current } : {}),
      });
      runtime.current.setPageActive(document.visibilityState === 'visible' && document.hasFocus());
      setSelfId(session.playerId);
      setCode(session.roomCode);
      setSessionCredential(session.sessionToken);
    } catch (cause) {
      if (joined)
        await productRoomPort(joined)
          .leave()
          .catch(() => {});
      if (session) await cancelSessionReservation(session);
      if (run === generation.current) {
        runtime.current = null;
        setSnapshot(null);
        setSessionCredential(null);
        const labels: Record<string, string> = {
          INVALID_REQUEST: '닉네임·초대 링크·방 코드를 확인해 주세요.',
          INVALID_INVITATION:
            access === 'gitlab-sso' && !invitation
              ? '로그인을 확인할 수 없습니다. 페이지를 새로고침해 다시 로그인해 주세요.'
              : '유효한 초대 링크가 필요합니다.',
          CAPACITY: '방이 가득 찼습니다.',
          ROOM_NOT_AVAILABLE: '입장할 수 없는 방입니다.',
          RATE_LIMITED: '잠시 기다린 뒤 다시 시도해 주세요.',
          ADMISSION_CLOSED: '지금은 입장을 받고 있지 않습니다.',
          INVALID_SESSION: '입장 시간이 만료됐습니다. 다시 입장해 주세요.',
        };
        setError(
          labels[cause instanceof Error ? cause.message : ''] ??
            '연결할 수 없습니다. 로그인과 네트워크 상태를 확인해 주세요.',
        );
      }
    } finally {
      if (pendingSession.current === session) pendingSession.current = null;
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
  const localControls =
    round && !inResult && round.phase !== 'LOBBY' ? (
      <>
        <LocalControls
          status={snapshot!.devices}
          mode={snapshot!.interaction.mode}
          previewHost={preview}
          onKeyboard={() => runtime.current?.selectInputMode('keyboard')}
          onMotion={async () => {
            await runtime.current?.calibrateMotion();
          }}
          onRecover={async () => {
            await runtime.current?.recoverDevices();
          }}
          onMicrophone={async (enabled) => {
            await runtime.current?.setMicrophone(enabled);
          }}
          canRecover={['DEVICE_CHECK', 'TEAM_PRACTICE', 'PLAYING'].includes(round.phase)}
          compact={worldVisible}
        />
        <AudioControls
          readStatus={readAudio}
          onPreferences={changeAudio}
          onTestTone={playTestTone}
          participants={snapshot?.roster?.players.filter((player) => player.playerId !== selfId)}
          canTestTone={['DEVICE_CHECK', 'TEAM_PRACTICE'].includes(round.phase)}
          compact={worldVisible}
        />
      </>
    ) : null;
  return (
    <main className={worldVisible ? 'product-shell playing-shell' : 'product-shell'}>
      <header>
        <h1>까꿍</h1>
        {snapshot && (
          <button className="quiet" onClick={() => void leave()}>
            나가기
          </button>
        )}
      </header>
      {solo && !snapshot ? (
        <SoloPracticeScreen onExit={finishSolo} />
      ) : !snapshot ? (
        <section className="admission">
          <h2>흑백 미로에서 만나요.</h2>
          <p>
            세 명의 도망자, 세 명의 술래.
            <br />
            {access === 'gitlab-sso'
              ? '방을 만들고 친구들에게 방 코드를 알려 주세요.'
              : access === 'guest'
                ? '닉네임으로 방을 만들고 친구들에게 초대 링크를 보내 주세요.'
                : '초대받은 친구들과 함께 시작하세요.'}
          </p>
          <p>
            PC 브라우저에서 6명이 함께하는 게임입니다. 카메라 필수 · 마이크 선택. 도망자 2명이
            탈출하면 도망자 팀이, 술래가 2명을 잡거나 시간을 버티면 술래 팀이 이깁니다.
          </p>
          <ol>
            <li>혼자 카메라와 조작을 먼저 점검해요.</li>
            <li>{access === 'guest' ? '초대 링크' : '방 코드'}를 나누고 여섯 명이 모여요.</li>
            <li>장치 점검과 팀 연습 후 추격전을 시작해요.</li>
          </ol>
          <button type="button" disabled={joining} onClick={() => setSolo(true)}>
            혼자 장치 점검·조작 체험
          </button>
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
            <button
              disabled={
                joining ||
                (!invitation && access !== 'gitlab-sso' && !(access === 'guest' && createRoom))
              }
            >
              {joining ? '입장 중…' : createRoom ? '방 만들기' : '방 참가'}
            </button>
            {joining && (
              <button type="button" className="quiet" onClick={() => void leave()}>
                입장 취소
              </button>
            )}
          </form>
          {!invitation && access === 'checking' && <p className="notice">접속 상태 확인 중…</p>}
          {!invitation && access === 'invitation' && (
            <p className="notice">유효한 초대 링크로 열어 주세요.</p>
          )}
          {access === 'gitlab-sso' && (
            <p className="notice">팀원 로그인이 확인됐습니다. 바로 방을 만들거나 참가하세요.</p>
          )}
          {access === 'guest' && (
            <p className="notice">
              {createRoom
                ? '가입 없이 시작해요. 방을 만든 뒤 초대 링크를 공유하세요.'
                : invitation
                  ? '초대받은 방에 참가합니다. 링크가 만료됐다면 방장에게 새 링크를 받아 주세요.'
                  : '친구 방은 방장이 보낸 초대 링크로 열어 주세요.'}
            </p>
          )}
          {access === 'failed' && (
            <p className="notice">
              접속 상태를 확인하지 못했습니다. 로그인과 네트워크 상태를 확인해 주세요.{' '}
              <button type="button" onClick={() => setAccessAttempt((attempt) => attempt + 1)}>
                접속 상태 다시 확인
              </button>
            </p>
          )}
          <p className="notice">
            <a className="asset-notices-link" href="/licenses/index.html">
              오픈소스 고지
            </a>
          </p>
        </section>
      ) : snapshot.lost ? (
        <ConnectionLostScreen
          onLeave={() => void leave()}
          expired={snapshot.roomExpired}
          removed={snapshot.removedByHost}
        />
      ) : (
        <>
          {preparationFeedback(round?.preparationIssue) && (
            <p role="alert" className="notice">
              {preparationFeedback(round?.preparationIssue)}
            </p>
          )}
          {round?.roomExpiresInSeconds !== undefined && (
            <p role="status" className="notice">
              이 방은 {round.roomExpiresInSeconds}초 후 정리됩니다. 준비를 마치거나 새 경기를 시작해
              주세요.
            </p>
          )}
          <QualityControl
            value={snapshot.quality}
            onChange={(value) => runtime.current?.quality(value)}
          />
          {!worldVisible && localControls}
          {snapshot.roster && round && ['LOBBY', 'DEVICE_CHECK'].includes(round.phase) && (
            <LobbyScreen
              roster={snapshot.roster}
              selfId={selfId}
              roomCode={code}
              access={snapshot.roomAccess}
              lockRequest={snapshot.requests.ROOM_LOCK}
              kickRequest={snapshot.requests.ROOM_KICK}
              onLock={(locked) => runtime.current?.send({ type: 'ROOM_LOCK', payload: { locked } })}
              onKick={(targetPlayerId) =>
                runtime.current?.send({ type: 'ROOM_KICK', payload: { targetPlayerId } })
              }
            />
          )}
          {sessionCredential &&
            snapshot.roster?.hostId === selfId &&
            round &&
            ['LOBBY', 'DEVICE_CHECK'].includes(round.phase) && (
              <RoomInvitationControls
                key={`${code}:${selfId}`}
                sessionToken={sessionCredential}
                roomCode={code}
                teamOnly={access === 'gitlab-sso'}
              />
            )}
          {round?.phase === 'DEVICE_CHECK' && (
            <DeviceCheckScreen
              status={snapshot.devices}
              ready={snapshot.roster?.players.find((p) => p.playerId === selfId)?.ready ?? false}
              onStart={async (microphone) => {
                await runtime.current?.startDevices(microphone);
              }}
              onReady={(value) => runtime.current?.ready(value)}
              faceGuidance={snapshot.faceGuidance ?? null}
            />
          )}
          {round && inResult && (
            <ResultScreen
              round={round}
              self={ended ?? null}
              host={snapshot.roster?.hostId === selfId}
              request={snapshot.requests.REMATCH}
              connectedCount={
                snapshot.roster?.players.filter((player) => player.connected).length ?? 0
              }
              onRematch={(mode) => runtime.current?.send({ type: 'REMATCH', payload: { mode } })}
            />
          )}
          {round &&
            !inResult &&
            ['MAP_FINALIZING', 'GAME_LOADING', 'COUNTDOWN'].includes(round.phase) && (
              <LoadingOverlay
                round={round}
                serverNow={clockTime}
                pending={snapshot.loadingPending}
              />
            )}
          {worldVisible && round && view?.self?.status === 'ACTIVE' && (
            <GameHud round={round} self={view.self} mode={snapshot.interaction.mode} />
          )}
          <div className="game-workspace">
            <aside className="game-sidebar">
              {worldVisible && localControls}
              {worldVisible &&
                (round?.phase === 'TEAM_PRACTICE' || round?.phase === 'PLAYING') &&
                view?.self?.status === 'ACTIVE' && (
                  <FaceGuidanceNotice notice={snapshot.faceGuidance} />
                )}
              {worldVisible && view && (
                <MiniMap
                  view={view}
                  markers={snapshot.markers}
                  tick={runtime.current?.renderTick() ?? round?.serverTick ?? 0}
                  ownerNames={Object.fromEntries(
                    snapshot.roster?.players.map((p) => [p.playerId, p.nickname]) ?? [],
                  )}
                />
              )}
              {worldVisible && view && round?.phase === 'TEAM_PRACTICE' && (
                <PracticeScreen
                  round={round}
                  view={view}
                  devices={snapshot.devices}
                  request={snapshot.requests.PRACTICE_READY}
                  readyReported={snapshot.practiceReady}
                  readSensors={readSensors}
                  onReady={() =>
                    runtime.current?.send({ type: 'PRACTICE_READY', payload: { ready: true } })
                  }
                />
              )}
              {worldVisible &&
              round?.phase === 'PLAYING' &&
              view?.self?.status === 'ACTIVE' &&
              view.self.challenge &&
              snapshot.interaction.mode === 'keyboard' ? (
                <KeyChallenge
                  challenge={view.self.challenge}
                  index={snapshot.keyIndex}
                  tick={runtime.current?.renderTick() ?? round?.serverTick ?? 0}
                  onKey={(key, repeat) => runtime.current?.challengeKey(key, repeat)}
                  onCancel={() =>
                    view.self?.status === 'ACTIVE' &&
                    view.self.challenge &&
                    runtime.current?.send({
                      type: 'EXIT_CANCEL',
                      payload: { challengeId: view.self.challenge.challengeId },
                    })
                  }
                />
              ) : (
                worldVisible &&
                round?.phase === 'PLAYING' &&
                view && (
                  <PoseChallenge
                    view={view}
                    tick={runtime.current?.renderTick() ?? round?.serverTick ?? 0}
                    progress={snapshot.poseProgress}
                    starting={snapshot.exitStarting}
                    send={(command) => runtime.current?.send(command)}
                  />
                )
              )}
              {worldVisible && view && (
                <ExchangePanel
                  view={view}
                  selected={snapshot.exchangeTarget}
                  tick={runtime.current?.renderTick() ?? round?.serverTick ?? 0}
                  request={
                    view.self?.status === 'ACTIVE' && view.self.exchange?.direction === 'incoming'
                      ? snapshot.requests.EXCHANGE_ACCEPT
                      : snapshot.requests.EXCHANGE_REQUEST
                  }
                  onSelect={(id) => runtime.current?.selectExchangeTarget(id)}
                  send={(command) => runtime.current?.send(command)}
                />
              )}
              {worldVisible && snapshot.exchangeNotice && (
                <p role="status">{snapshot.exchangeNotice}</p>
              )}
              {worldVisible && view && (
                <RestraintHud
                  view={view}
                  tick={runtime.current?.renderTick() ?? round?.serverTick ?? 0}
                />
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
            </aside>
            {worldVisible && view && (
              <section className="product-stage">
                <div className="product-canvas">
                  <WorldCanvas
                    view={view}
                    faces={runtime.current?.faces}
                    ownerNames={Object.fromEntries(
                      snapshot.roster?.players.map((p) => [p.playerId, p.nickname]) ?? [],
                    )}
                    quality={snapshot.quality}
                    renderTick={() => runtime.current?.renderTick() ?? null}
                    {...(metrics.current
                      ? { onMetrics: (frame) => metrics.current?.recordRender(frame) }
                      : {})}
                  />
                </div>
              </section>
            )}
          </div>
          {/* 문구가 생기고 사라져도 페이지 높이가 바뀌지 않도록 자리를 항상 잡아 둔다 */}
          <p role="status" className="command-feedback">
            {snapshot.request?.type !== 'REMATCH' ? commandFeedback(snapshot.request) : null}
          </p>
          {snapshot.error && <p role="alert">{snapshot.error}</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
