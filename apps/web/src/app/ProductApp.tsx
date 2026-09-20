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
import { DemoPanel } from '../features/game/flow/DemoPanel';
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
import { EventLog } from '../features/game/flow/EventLog';
import { GameStatusChrome } from '../features/game/flow/CamcorderOverlay';
import { Hotbar } from '../features/game/flow/Hotbar';
import { crosshairState, installHint } from '../features/game/flow/install-hint';
import { QualityControl } from '../features/game/flow/QualityControl';
import { MiniMap } from '../features/game/map/MiniMap';
import { PoseChallenge } from '../features/game/pose/PoseChallenge';
import { KeyChallenge } from '../features/game/pose/KeyChallenge';
import { PracticeScreen } from '../features/game/flow/PracticeScreen';
import { ExchangePanel } from '../features/game/map/ExchangePanel';
import { EquipmentHud } from '../features/game/equipment/EquipmentHud';
import { createDemoFaceTexture } from '../features/game/scene/demo-face';
import { restraintPresenter } from '../features/game/equipment/restraint-presenter';
import { CueFlash } from '../features/game/flow/CueFlash';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { SoloPracticeScreen } from '../features/game/solo/SoloPracticeScreen';
import { bindProductRoom, type ProductSnapshot } from './product-runtime';
import {
  createRuntimeMetrics,
  metricsRequested,
  publishRuntimeMetrics,
  type RuntimeMetrics,
} from './runtime-metrics';
import { BrandLogo } from './BrandLogo';

export function ProductApp({
  invitation,
  initialRoom = '',
  demoSession,
}: {
  invitation: string;
  initialRoom?: string;
  /** S15P21C204-260. Operator demo session from the address fragment; absent for players. */
  demoSession?: SessionResponse;
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
  // Demo rooms only: one drawn face shared by every puppet, disposed with the page.
  const demoFace = useRef<ReturnType<typeof createDemoFaceTexture> | null>(null);
  if (demoSession && demoFace.current === null) demoFace.current = createDemoFaceTexture();
  useEffect(() => () => demoFace.current?.dispose(), []);
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
  const entered = useRef(false);
  useEffect(() => {
    // The operator's demo session opens its room straight away: there is no form for it.
    if (!demoSession || entered.current) return;
    entered.current = true;
    // The session is fixed for the life of the page, so this runs once.
    void enter(demoSession);
  }, [demoSession]);
  async function join(event: React.FormEvent) {
    event.preventDefault();
    await enter();
  }
  /** Joins with a session: the form requests one, the demo entry already has it. */
  async function enter(given: SessionResponse | null = null) {
    if (joining || runtime.current || solo) return;
    // A demo session is handed to the page and cannot be asked for again, so the page never throws
    // it away: an abandoned seat is freed by the server's own admission deadline instead. Only a
    // session this page requested is one it may cancel.
    const owned = given === null;
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
      session =
        given ??
        (await requestSession(
          createRoom
            ? { ...base, createRoom: true }
            : { ...base, createRoom: false, roomCode: roomCode.trim().toUpperCase() },
        ));
      if (run !== generation.current) {
        if (owned) await cancelSessionReservation(session);
        return;
      }
      if (owned) pendingSession.current = session;
      const room = await joinProductRoom(session);
      joined = room;
      if (pendingSession.current === session) pendingSession.current = null;
      if (run !== generation.current) {
        await room.leave();
        if (owned) await cancelSessionReservation(session);
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
      if (session && owned) await cancelSessionReservation(session);
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
          TOO_MANY_ROOMS:
            '이미 열어 둔 방이 있습니다. 쓰지 않는 방을 닫거나 잠시 뒤 다시 시도해 주세요.',
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
  const activeSelf = view?.self?.status === 'ACTIVE' ? view.self : null;
  const spectating = round?.phase === 'PLAYING' ? (view?.spectating ?? null) : null;
  const ended = snapshot?.endedSelf ?? (view?.self?.status !== 'ACTIVE' ? view?.self : null);
  const inResult =
    !!round && ((!spectating && !!ended) || ['RESULT', 'ABORTED'].includes(round.phase));
  const worldVisible =
    !!round &&
    !inResult &&
    ['PLAYING', 'TEAM_PRACTICE'].includes(round.phase) &&
    (activeSelf !== null || spectating !== null);
  const interactiveWorld = worldVisible && activeSelf !== null;
  const playerNames = Object.fromEntries(
    snapshot?.roster?.players.map((player) => [player.playerId, player.nickname]) ?? [],
  );
  const renderTick = () => runtime.current?.renderTick() ?? round?.serverTick ?? 0;
  // S15P21C204-278. 지금 이 칸에 선택한 장비를 놓을 수 있는지. 술래가 아니면 null 이다.
  const equipmentHint = installHint(
    view ?? null,
    snapshot?.interaction.selectedEquipment ?? 'sensor',
    renderTick(),
  );
  // S15P21C204-276. 접히는 오버레이는 손이 필요한 일이 있을 때만 펼쳐진 채로 시작한다.
  const drawerUrgent =
    round?.phase === 'TEAM_PRACTICE' ||
    (view?.self?.status === 'ACTIVE' &&
      (view.self.challenge !== null || view.self.exchange?.direction === 'incoming'));
  // S15P21C204-275. 시작 전 대기는 한 화면이 덮는다. 준비 실패 안내도 그 화면 안에서 보여 준다.
  const loadingCovered =
    !!round && !inResult && ['MAP_FINALIZING', 'GAME_LOADING', 'COUNTDOWN'].includes(round.phase);
  // 구속 중에는 화면 가장자리를 어둡게 유지한다(S15P21C204-261). 남은 시간은 RestraintHud 가 쓴다.
  const restrained =
    interactiveWorld &&
    (restraintPresenter(view ?? null, runtime.current?.renderTick() ?? round?.serverTick ?? 0)
      ?.restraintSeconds ?? 0) > 0;
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
          variant={round.phase === 'TEAM_PRACTICE' ? 'quiet' : 'full'}
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
        <BrandLogo />
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
          {preparationFeedback(round?.preparationIssue) && !loadingCovered && (
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
              motion={snapshot.motionCheck}
              onCalibrate={async () => {
                await runtime.current?.calibrateMotion();
              }}
              onMicrophone={async (enabled) => {
                await runtime.current?.setMicrophone(enabled);
              }}
              onTestTone={playTestTone}
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
          {round && loadingCovered && (
            <LoadingOverlay round={round} serverNow={clockTime} pending={snapshot.loadingPending} />
          )}
          {worldVisible && view && (
            <section className="game-stage" data-restrained={restrained || undefined}>
              <div className="product-canvas">
                <WorldCanvas
                  view={view}
                  faces={runtime.current?.faces}
                  ownerNames={playerNames}
                  quality={snapshot.quality}
                  standIn={demoFace.current}
                  renderTick={() => runtime.current?.renderTick() ?? null}
                  {...(metrics.current
                    ? { onMetrics: (frame) => metrics.current?.recordRender(frame) }
                    : {})}
                />
              </div>
              <GameStatusChrome
                status={
                  round ? (
                    <>
                      <GameHud
                        round={round}
                        {...(activeSelf
                          ? { self: activeSelf, mode: snapshot.interaction.mode }
                          : {
                              spectating: spectating!,
                              playerNames,
                              onSpectate: (targetPlayerId: string) =>
                                runtime.current?.send({
                                  type: 'SPECTATE',
                                  payload: { targetPlayerId },
                                }),
                            })}
                      />
                      {interactiveWorld && <EventLog events={snapshot.events} />}
                    </>
                  ) : null
                }
              />
              {interactiveWorld && <FaceGuidanceNotice notice={snapshot.faceGuidance} />}
              {/* 2 중앙 십자선. 설치·교환이 가능한 칸이면 색이 바뀐다(W4는 별도 스토리). */}
              {interactiveWorld && (
                <div
                  className="crosshair"
                  aria-hidden="true"
                  data-install={crosshairState(equipmentHint)}
                />
              )}
              {/* 아래 가운데 핫바. 사건 기록은 접근성 레이어에만 남기고 시야를 가리지 않는다. */}
              {interactiveWorld && (
                <Hotbar
                  view={view}
                  tick={renderTick()}
                  selected={snapshot.interaction.selectedEquipment}
                  exchangeTarget={snapshot.exchangeTarget}
                  hint={equipmentHint}
                  onSelectEquipment={(kind) => runtime.current?.selectEquipment(kind)}
                />
              )}
              {/* 5 우하단 미니맵 */}
              <MiniMap
                view={view}
                markers={snapshot.markers}
                tick={renderTick()}
                ownerNames={playerNames}
              />
              {/* 6 접히는 오버레이. 급한 일이 있을 때만 펼쳐진 채로 시작한다. */}
              {interactiveWorld && (
                <details className="hud-drawer" open={drawerUrgent}>
                  <summary>교환 · 도전 · 장치 · 소리</summary>
                  <div className="hud-drawer-body">
                    {round?.phase === 'TEAM_PRACTICE' && (
                      <PracticeScreen
                        round={round}
                        view={view}
                        devices={snapshot.devices}
                        request={snapshot.requests.PRACTICE_READY}
                        readyReported={snapshot.practiceReady}
                        readSensors={readSensors}
                        onReady={() =>
                          runtime.current?.send({
                            type: 'PRACTICE_READY',
                            payload: { ready: true },
                          })
                        }
                      />
                    )}
                    {round?.phase === 'PLAYING' &&
                      (view.self?.status === 'ACTIVE' &&
                      view.self.challenge &&
                      snapshot.interaction.mode === 'keyboard' ? (
                        <KeyChallenge
                          challenge={view.self.challenge}
                          index={snapshot.keyIndex}
                          tick={renderTick()}
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
                        <PoseChallenge
                          view={view}
                          tick={renderTick()}
                          progress={snapshot.poseProgress}
                          starting={snapshot.exitStarting}
                          send={(command) => runtime.current?.send(command)}
                        />
                      ))}
                    <ExchangePanel
                      view={view}
                      selected={snapshot.exchangeTarget}
                      tick={renderTick()}
                      request={
                        view.self?.status === 'ACTIVE' &&
                        view.self.exchange?.direction === 'incoming'
                          ? snapshot.requests.EXCHANGE_ACCEPT
                          : snapshot.requests.EXCHANGE_REQUEST
                      }
                      onSelect={(id) => runtime.current?.selectExchangeTarget(id)}
                      send={(command) => runtime.current?.send(command)}
                    />
                    {snapshot.exchangeNotice && <p role="status">{snapshot.exchangeNotice}</p>}
                    <EquipmentHud
                      view={view}
                      tick={renderTick()}
                      selected={snapshot.interaction.selectedEquipment}
                      request={snapshot.requests.INSTALL}
                      onSelect={(kind) => runtime.current?.selectEquipment(kind)}
                      send={(command) => runtime.current?.send(command)}
                    />
                    {snapshot.demo && (
                      <DemoPanel
                        demo={snapshot.demo}
                        onRun={(scenario) => runtime.current?.runDemoScenario(scenario)}
                      />
                    )}
                    {localControls}
                  </div>
                </details>
              )}
            </section>
          )}
          <CueFlash flash={snapshot.cueFlash} />
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
