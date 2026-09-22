import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestSession,
  requestSessionAccess,
  joinProductRoom,
  productRoomPort,
  cancelSessionReservation,
  forgetDemoSession,
} from '../features/room/product-session';
import type { SessionAccessResponse, SessionResponse } from '@kkakkung/protocol/game-messages';
import { LobbyScreen } from '../features/room/LobbyScreen';
import { LobbyBackdrop } from '../features/room/LobbyBackdrop';
import { DEFAULT_MAP_SIZE } from '../features/room/map-size';
import { RoomInvitationControls } from '../features/room/RoomInvitationControls';
import { useMediaConsent } from '../features/room/use-media-consent';
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
import { SpectatorBar } from '../features/game/flow/SpectatorBar';
import { EventLog } from '../features/game/flow/EventLog';
import { GameStatusChrome } from '../features/game/flow/CamcorderOverlay';
import { Hotbar } from '../features/game/flow/Hotbar';
import { RoughDefs } from '../features/game/flow/RoughDefs';
import { SettingsWindow } from '../features/game/flow/SettingsWindow';
import { ControlsPane, DisplayPane, SoundPane } from '../features/game/flow/SettingsPanes';
import { crosshairState, installHint } from '../features/game/flow/install-hint';
import { interactPrompt } from '../features/game/flow/interact-prompt';
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
import { MINIMAP_WINDOW_CELLS } from '../features/game/map/minimap-render';
import { DEFAULT_AUDIO_PREFERENCES } from '../features/media/audio-preferences';
import { debugFeed, useDebugOverlayEnabled } from '../features/debug/debug-feed';
import {
  loadHomeSettings,
  saveHomeSettings,
  type HomeSettings,
} from '../features/room/home-settings';

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
  // S15P21C204-292. 동의는 장치 점검 화면에서 받지만, 장치 단추는 `LocalControls` 에도 있다.
  // 두 곳이 같은 답을 보도록 여기서 한 번만 들고 있는다.
  const consent = useMediaConsent();
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState(initialRoom);
  const [createRoom, setCreateRoom] = useState(!initialRoom);
  const [joining, setJoining] = useState(false);
  const [solo, setSolo] = useState(false);
  // S15P21C204-295. 홈 옵션. 이 기기에만 저장되고 입장할 때 런타임에 한 번 적용된다.
  const [settings, setSettings] = useState<HomeSettings>(() => loadHomeSettings());
  const updateSettings = useCallback((patch: Partial<HomeSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      saveHomeSettings(next);
      return next;
    });
  }, []);
  const debugOverlay = useDebugOverlayEnabled();
  const backgroundPaused = !settings.backgroundMotion;
  const [homePanel, setHomePanel] = useState<'title' | 'admission' | 'options'>(
    invitation || initialRoom ? 'admission' : 'title',
  );
  // S15P21C204-295. 홈 옵션도 Esc 로 닫는다. 게임 안 설정 창과 같은 키다.
  useEffect(() => {
    if (homePanel !== 'options') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.repeat) setHomePanel('title');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [homePanel]);
  useEffect(() => {
    if (invitation || initialRoom) setHomePanel('admission');
  }, [invitation, initialRoom]);
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
  // S15P21C204-312. 관리자가 직접 나가면 이 탭에 남긴 데모 세션도 지운다. 새로고침(pagehide)은
  // 나가는 것이 아니므로 그대로 두어 같은 경기로 돌아오게 한다.
  const leaveByChoice = useCallback(() => {
    if (demoSession) forgetDemoSession();
    void leave();
  }, [demoSession, leave]);
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
  const demoEntry = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    // The operator's demo session opens its room straight away: there is no form for it.
    if (!demoSession) return;
    // S15P21C204-318. StrictMode (dev) tears effects down once and runs them again. The teardown
    // bumps the generation, so the first entry leaves the room it joined; a guard that entered
    // only once then left the page on "입장 중…" for good. Each run waits for the previous entry to
    // settle, so the second joins after the first has let go of the one demo seat. The server
    // keeps that seat for a demo session across a disconnect (312).
    demoEntry.current = demoEntry.current.then(() => enter(demoSession));
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
      // 홈 옵션을 이 입장에 적용한다. 경기 중 바꾼 값은 그 방에서만 유효하다.
      runtime.current.quality(settings.quality);
      runtime.current.setAudioPreferences({
        ...DEFAULT_AUDIO_PREFERENCES,
        volume: settings.volume,
        muted: settings.muted,
      });
      setSelfId(session.playerId);
      setCode(session.roomCode);
      setSessionCredential(session.sessionToken);
    } catch (cause) {
      // 끝났거나 닫힌 데모 방이다. 새로고침이 거기로 다시 가지 않게 한다.
      if (!owned) forgetDemoSession();
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
  // S15P21C204-295. 지금 앞에 있는 것에 쓰는 키. 아이템 칸(핫바)과는 다른 줄로 나뉘어 있다.
  const interact = interactPrompt({
    view: view ?? null,
    tick: renderTick(),
    exchangeTarget: snapshot?.exchangeTarget,
  });
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
          consented={consent.consented}
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
    <main
      className={
        worldVisible
          ? 'product-shell playing-shell'
          : !snapshot && !solo
            ? `product-shell home-shell home-${homePanel}`
            : !snapshot && solo
              ? 'product-shell solo-shell'
              : 'product-shell'
      }
    >
      <RoughDefs />
      {!snapshot && !solo && <LobbyBackdrop paused={backgroundPaused} />}
      <header>
        <BrandLogo />
        {snapshot && (
          <button className="quiet" onClick={leaveByChoice}>
            나가기
          </button>
        )}
      </header>
      {solo && !snapshot ? (
        <SoloPracticeScreen onExit={finishSolo} />
      ) : !snapshot && (homePanel === 'title' || homePanel === 'options') ? (
        <>
          <nav className="title-menu" aria-label="메인 메뉴">
            <button type="button" onClick={() => setHomePanel('admission')}>
              시작하기
            </button>
            <button type="button" onClick={() => setHomePanel('options')}>
              옵션
            </button>
          </nav>
          {homePanel === 'options' && (
            <aside className="settings-overlay" aria-label="옵션">
              <SettingsWindow
                variant="overlay"
                eyebrow="설정"
                title="옵션"
                initialTab="display"
                lead={{ label: '돌아가기', run: () => setHomePanel('title') }}
                footer={
                  <>
                    <kbd>Esc</kbd> 눌러 돌아가기
                    <a className="asset-notices-link" href="/licenses/index.html">
                      오픈소스 고지
                    </a>
                  </>
                }
                tabs={[
                  {
                    id: 'display',
                    label: '화면',
                    content: (
                      <DisplayPane
                        settings={settings}
                        onChange={updateSettings}
                        debugOverlay={debugOverlay}
                        onDebugOverlay={(value) => debugFeed.setEnabled(value)}
                        applied="화면 품질은 다음 입장부터 적용됩니다. 배경은 기기의 동작 줄이기 설정을 따릅니다."
                      />
                    ),
                  },
                  {
                    id: 'sound',
                    label: '소리',
                    content: <SoundPane settings={settings} onChange={updateSettings} />,
                  },
                  { id: 'controls', label: '조작', content: <ControlsPane /> },
                  {
                    id: 'device',
                    label: '카메라 · 장치',
                    locked:
                      '카메라 점검은 방에 들어간 뒤 Esc 설정에서 합니다. 홈에서는 카메라를 켜지 않아요.',
                    content: null,
                  },
                ]}
              />
            </aside>
          )}
        </>
      ) : !snapshot ? (
        <>
          <nav className="title-menu" aria-label="메인 메뉴" aria-hidden="true" />
          <aside className="settings-overlay" aria-label="입장">
            <SettingsWindow
              variant="overlay"
              eyebrow="입장"
              title="같이 할 준비"
              initialTab="join"
              lead={{ label: '돌아가기', disabled: joining, run: () => setHomePanel('title') }}
              footer={
                <>
                  <span className="home-specs">
                    <span>6인 멀티플레이</span>
                    <span>PC · 카메라 필수</span>
                  </span>
                  <a className="asset-notices-link" href="/licenses/index.html">
                    오픈소스 고지
                  </a>
                </>
              }
              tabs={[
                {
                  id: 'join',
                  label: '방 잡기',
                  content: (
                    <>
                      <h3>같이 할 준비</h3>
                      <form onSubmit={(event) => void join(event)}>
                        <dl className="settings-rows">
                          <div>
                            <dt>
                              <label htmlFor="product-nickname">닉네임</label>
                            </dt>
                            <dd>
                              <input
                                id="product-nickname"
                                autoComplete="off"
                                maxLength={20}
                                placeholder="닉네임 입력"
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                disabled={joining}
                                required
                              />
                            </dd>
                          </div>
                          <div>
                            <dt id="join-mode">입장 방법</dt>
                            <dd>
                              <fieldset className="join-mode" disabled={joining}>
                                <legend>입장 방법</legend>
                                <label>
                                  <input
                                    type="radio"
                                    checked={createRoom}
                                    onChange={() => setCreateRoom(true)}
                                  />
                                  새 방 만들기
                                </label>
                                <label>
                                  <input
                                    type="radio"
                                    checked={!createRoom}
                                    onChange={() => setCreateRoom(false)}
                                  />
                                  친구 방 참가
                                </label>
                              </fieldset>
                            </dd>
                          </div>
                          {!createRoom && (
                            <div>
                              <dt>
                                <label htmlFor="room-code">방 코드</label>
                              </dt>
                              <dd>
                                <input
                                  id="room-code"
                                  value={roomCode}
                                  maxLength={6}
                                  onChange={(e) => setRoomCode(e.target.value)}
                                  required
                                  disabled={joining}
                                />
                              </dd>
                            </div>
                          )}
                        </dl>
                        <div className="join-actions">
                          <button
                            className="join-submit"
                            disabled={
                              joining ||
                              (!invitation &&
                                access !== 'gitlab-sso' &&
                                !(access === 'guest' && createRoom))
                            }
                          >
                            {joining ? '입장 중…' : createRoom ? '방 만들기' : '방 참가'}
                          </button>
                          {joining && (
                            <button type="button" onClick={leaveByChoice}>
                              입장 취소
                            </button>
                          )}
                        </div>
                      </form>
                      {!invitation && access === 'checking' && (
                        <p className="pause-note">접속 상태 확인 중…</p>
                      )}
                      {!invitation && access === 'invitation' && (
                        <p className="pause-note">유효한 초대 링크로 열어 주세요.</p>
                      )}
                      {access === 'gitlab-sso' && (
                        <p className="pause-note">
                          팀원 로그인이 확인됐습니다. 바로 방을 만들거나 참가하세요.
                        </p>
                      )}
                      {access === 'guest' && (
                        <p className="pause-note">
                          {createRoom
                            ? '가입 없이 시작해요. 방을 만든 뒤 초대 링크를 공유하세요.'
                            : invitation
                              ? '초대받은 방에 참가합니다. 링크가 만료됐다면 방장에게 새 링크를 받아 주세요.'
                              : '친구 방은 방장이 보낸 초대 링크로 열어 주세요.'}
                        </p>
                      )}
                      {access === 'failed' && (
                        <p className="pause-note">
                          접속 상태를 확인하지 못했습니다. 로그인과 네트워크 상태를 확인해 주세요.{' '}
                          <button
                            type="button"
                            onClick={() => setAccessAttempt((attempt) => attempt + 1)}
                          >
                            접속 상태 다시 확인
                          </button>
                        </p>
                      )}
                    </>
                  ),
                },
                {
                  id: 'solo',
                  label: '튜토리얼',
                  run: () => setSolo(true),
                  content: null,
                },
                {
                  id: 'guide',
                  label: '게임 방법',
                  content: (
                    <>
                      <h3>처음 오셨나요?</h3>
                      <p className="pause-note">
                        PC 브라우저에서 6명이 함께합니다. 카메라 필수 · 마이크 선택.
                      </p>
                      <ol className="join-guide">
                        <li>혼자 카메라와 조작을 먼저 점검해요.</li>
                        <li>
                          {access === 'guest' ? '초대 링크' : '방 코드'}를 나누고 여섯 명이 모여요.
                        </li>
                        <li>장치 점검과 팀 연습 후 추격전을 시작해요.</li>
                      </ol>
                      <p className="pause-note">
                        도망자 2명이 탈출하면 도망자 팀이, 술래가 2명을 잡거나 3분을 버티면 술래
                        팀이 이깁니다.
                      </p>
                    </>
                  ),
                },
              ]}
            />
          </aside>
        </>
      ) : snapshot.lost ? (
        <ConnectionLostScreen
          onLeave={leaveByChoice}
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
              // S15P21C204-312. 데모 방은 초대·잠금·강퇴가 범위 밖이다(D6). 잠그면 관리자 자신의
              // 새로고침 재입장까지 막히므로 단추를 두지 않는다.
              {...(snapshot.demo
                ? {}
                : {
                    onLock: (locked: boolean) =>
                      runtime.current?.send({ type: 'ROOM_LOCK', payload: { locked } }),
                    onKick: (targetPlayerId: string) =>
                      runtime.current?.send({ type: 'ROOM_KICK', payload: { targetPlayerId } }),
                  })}
              mapSize={snapshot.roomMap?.size ?? DEFAULT_MAP_SIZE}
              // 데모 방은 로비를 곧바로 지나므로 준비 단계에서 맵 크기를 고른다(313).
              canChooseMapSize={
                round.phase === 'LOBBY' ||
                (Boolean(snapshot.demo) && round.phase === 'DEVICE_CHECK')
              }
              mapSizeRequest={snapshot.requests.ROOM_MAP_SIZE}
              {...(snapshot.demo
                ? {
                    mapSizeNote:
                      '준비 완료를 누르기 전까지 고를 수 있습니다. 목록은 경기에 들어가면 나옵니다.',
                  }
                : {})}
              onSelectMapSize={(size) =>
                runtime.current?.send({ type: 'ROOM_MAP_SIZE', payload: { size } })
              }
            />
          )}
          {sessionCredential &&
            !snapshot.demo &&
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
              consented={consent.consented}
              onConsent={consent.accept}
              demo={Boolean(snapshot.demo)}
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
              demo={Boolean(snapshot.demo)}
              onRematch={(mode, role) =>
                runtime.current?.send({
                  type: 'REMATCH',
                  payload: role ? { mode, role } : { mode },
                })
              }
            />
          )}
          {round && loadingCovered && (
            <LoadingOverlay round={round} serverNow={clockTime} pending={snapshot.loadingPending} />
          )}
          {worldVisible && view && (
            // S15P21C204-313. 데모의 관리자 패널은 무대 위에 얹지 않고 옆 열로 뺀다. 무대 위에서는
            // 미니맵·HUD 와 겹쳐 시연 화면을 가렸다. 일반 방은 감싸개가 레이아웃에 끼지 않는다.
            <div className={snapshot.demo ? 'demo-layout' : 'stage-layout'}>
              <section className="game-stage" data-restrained={restrained || undefined}>
                <div className="product-canvas">
                  <WorldCanvas
                    view={view}
                    faces={runtime.current?.faces}
                    ownerNames={playerNames}
                    quality={snapshot.quality}
                    standIn={demoFace.current}
                    grabAnimationId={snapshot.grabAnimationId}
                    renderTick={() => runtime.current?.renderTick() ?? null}
                    {...(metrics.current
                      ? { onMetrics: (frame) => metrics.current?.recordRender(frame) }
                      : {})}
                  />
                </div>
                <GameStatusChrome
                  role={activeSelf?.role ?? null}
                  remainingSeconds={
                    round && round.deadlineTick !== null
                      ? Math.max(0, Math.ceil((round.deadlineTick - round.serverTick) / 20))
                      : null
                  }
                  status={
                    round ? (
                      <>
                        <GameHud
                          round={round}
                          {...(activeSelf
                            ? { self: activeSelf, mode: snapshot.interaction.mode }
                            : {})}
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
                {/* 십자선 아래 상호작용 줄. 아이템(핫바)과 달리 지금 앞에 있는 것에 쓰는 키다. */}
                {interactiveWorld && interact && (
                  <p className="interact-prompt" role="status">
                    <kbd>{interact.key}</kbd>
                    {interact.label}
                  </p>
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
                {/* 관전 오버레이. 핫바가 없는 관전자에게 아래 가운데를 그대로 쓴다(320). */}
                {spectating && (
                  <SpectatorBar
                    spectating={spectating}
                    playerNames={playerNames}
                    onSpectate={(targetPlayerId) =>
                      runtime.current?.send({ type: 'SPECTATE', payload: { targetPlayerId } })
                    }
                  />
                )}
                {/* 5 우하단 미니맵 */}
                <MiniMap
                  view={view}
                  markers={snapshot.markers}
                  tick={renderTick()}
                  ownerNames={playerNames}
                  windowCells={MINIMAP_WINDOW_CELLS}
                  renderTick={renderTick}
                  operatorExit={snapshot.demo?.operatorExit ?? null}
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
                      {localControls}
                    </div>
                  </details>
                )}
              </section>
              {snapshot.demo && (
                <DemoPanel
                  demo={snapshot.demo}
                  phase={round.phase}
                  onRun={(scenario) => runtime.current?.runDemoScenario(scenario)}
                  onRunWithOptions={(scenario, options) =>
                    runtime.current?.runDemoScenario(scenario, options)
                  }
                  onAbort={() => runtime.current?.abortDemoRound()}
                />
              )}
            </div>
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
