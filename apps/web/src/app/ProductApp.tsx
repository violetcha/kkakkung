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
import { ConsentGate } from '../features/room/ConsentGate';
import { deviceReady } from '../features/game/flow/device-readiness';
import { ReadyCheck } from '../features/room/ReadyCheck';
import { DemoPanel } from '../features/game/flow/DemoPanel';
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
import { PracticeQuests } from '../features/game/flow/PracticeQuests';
import { SelfCorner } from '../features/game/flow/SelfCorner';
import { EMPTY_LESSONS, observeLessons } from '../features/game/flow/practice-lessons';
import { ExchangePanel } from '../features/game/map/ExchangePanel';
import { EquipmentHud } from '../features/game/equipment/EquipmentHud';
import { createDemoFaceTexture } from '../features/game/scene/demo-face';
import { CanvasTexture, SRGBColorSpace } from 'three';
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
  showcaseSession,
}: {
  invitation: string;
  initialRoom?: string;
  /** S15P21C204-260. Operator demo session from the address fragment; absent for players. */
  demoSession?: SessionResponse;
  /** 발표 시연 방 세션. `/showcase` 가 발급해 주소 조각으로 넘긴다. 미디어는 일반 경기와 같다. */
  showcaseSession?: SessionResponse;
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
  // S15P21C204-295. 대기실의 준비는 "카메라를 켜고 준비됐다고 알린다" 하나다. 동의를 아직 받지
  // 않았으면 먼저 받고, 켜는 데 실패하면 준비를 보고하지 않는다(빈 카메라로 시작하지 않는다).
  const [readying, setReadying] = useState(false);
  /** 동의를 받은 뒤 이어서 준비를 보고할 때 쓴다. 동의 창은 준비를 누를 때만 뜬다. */
  const [consentAsk, setConsentAsk] = useState(false);
  /** 방 안 설정 창. Esc 와 머리말의 설정 단추가 같은 창을 연다. */
  const [roomMenu, setRoomMenu] = useState(false);
  /** 장치 점검 창. 준비를 누르면 열리고 준비가 보고되면 닫힌다. */
  const [deviceCheck, setDeviceCheck] = useState(false);
  // 준비를 누르면 카메라를 켜고 점검 창을 연다. 준비 보고는 점검을 통과한 뒤 그 창에서 한다.
  const startAndReady = useCallback(async () => {
    setDeviceCheck(true);
    setReadying(true);
    setError('');
    try {
      await runtime.current?.startDevices(false);
    } catch {
      setError('카메라를 켜지 못했습니다. 권한을 확인하고 다시 눌러 주세요.');
    } finally {
      setReadying(false);
    }
  }, []);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<'checking' | SessionAccessResponse['method'] | 'failed'>(
    'checking',
  );
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null);
  const [selfId, setSelfId] = useState('');
  // 대기실 타일이 쓰는 얼굴. 내 것은 가공 얼굴을 그리는 면 그대로, 남의 것은 받은 얼굴이다.
  const selfFace = useRef<{ surface: HTMLCanvasElement | null; texture: CanvasTexture | null }>({
    surface: null,
    texture: null,
  });
  useEffect(
    () => () => {
      selfFace.current.texture?.dispose();
      selfFace.current = { surface: null, texture: null };
    },
    [],
  );
  const lobbyFace = useCallback(
    (playerId: string) => {
      if (playerId !== selfId) return runtime.current?.faces.get(playerId) ?? null;
      const surface = runtime.current?.processedFaceSurface() ?? null;
      if (surface !== selfFace.current.surface) {
        selfFace.current.texture?.dispose();
        if (surface) {
          const texture = new CanvasTexture(surface);
          texture.colorSpace = SRGBColorSpace;
          selfFace.current = { surface, texture };
        } else selfFace.current = { surface: null, texture: null };
      }
      return selfFace.current.texture;
    },
    [selfId],
  );
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
  /**
   * S15P21C204-295. 미리보기 video 가 화면에서 떨어지면 브라우저가 프레임 콜백을 멈춘다.
   * 그러면 얼굴 표본이 끊겨 타일 얼굴이 기본 얼굴로 내려간다. 점검 창을 닫은 뒤에는 보이지
   * 않는 이 자리에 붙여 두어 카메라가 계속 흐르게 한다.
   */
  const facePump = useRef<HTMLDivElement | null>(null);
  const checkHost = useRef<HTMLDivElement | null>(null);
  const holdPreview = useCallback((element: HTMLDivElement | null) => {
    facePump.current = element;
  }, []);
  const checkPreview = useCallback((element: HTMLDivElement | null) => {
    checkHost.current = element;
  }, []);
  /**
   * S15P21C204-344. 자세를 잡는 동안에는 도전 쪽이 미리보기를 가져간다. 우상단 캠코더 창은
   * 상대가 보는 내 아바타라 프레이밍을 알 수 없어, 팔이 화면에 들어왔는지 여기서만 본다.
   */
  const poseHost = useRef<HTMLDivElement | null>(null);
  const posePreview = useCallback((element: HTMLDivElement | null) => {
    poseHost.current = element;
  }, []);
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
    // 시연 방 세션도 같다: 역할과 이름은 /showcase 에서 이미 골랐다.
    const given = demoSession ?? showcaseSession;
    if (!given) return;
    // S15P21C204-318. StrictMode (dev) tears effects down once and runs them again. The teardown
    // bumps the generation, so the first entry leaves the room it joined; a guard that entered
    // only once then left the page on "입장 중…" for good. Each run waits for the previous entry to
    // settle, so the second joins after the first has let go of the one demo seat. The server
    // keeps that seat for a demo session across a disconnect (312).
    demoEntry.current = demoEntry.current.then(() => enter(given));
  }, [demoSession, showcaseSession]);
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
  const selfSeat = snapshot?.roster?.players.find((player) => player.playerId === selfId) ?? null;
  // 대기실(사람 모으기·장치 점검)은 스크롤 없는 한 화면이다.
  const inLobby = Boolean(
    snapshot?.roster && round && ['LOBBY', 'DEVICE_CHECK'].includes(round.phase),
  );
  const DEVICE_STATE_LABELS: Record<string, string> = {
    idle: '꺼짐',
    off: '사용 안 함',
    ready: '준비됨',
    locked: '권한 필요',
    denied: '허용 안 됨',
    failed: '다시 점검',
    requesting: '권한 확인 중',
    loading: '불러오는 중',
    running: '보정 중',
  };
  const lobbyDevices = snapshot
    ? (
        [
          ['웹캠', snapshot.devices.camera],
          ['얼굴 추적', snapshot.devices.vision],
          ['중립 자세 보정', snapshot.devices.calibration],
          ['마이크', snapshot.devices.microphone],
        ] as const
      ).map(([label, state]) => ({
        label,
        state: DEVICE_STATE_LABELS[state] ?? state,
      }))
    : [];
  // S15P21C204-295. 대기실의 준비는 "카메라를 켜고 자세를 점검한 뒤 준비됐다고 알린다"다.
  // 동의를 아직 받지 않았으면 먼저 받고, 점검 창에서 통과해야 준비가 보고된다.
  const demoRoom = Boolean(snapshot?.demo);
  const devices = snapshot?.devices;
  const motion = snapshot?.motionCheck;
  const reportReady = useCallback(
    async (next: boolean) => {
      if (!next) {
        runtime.current?.ready(false);
        return;
      }
      if (!consent.consented) {
        setConsentAsk(true);
        return;
      }
      // 이미 점검을 통과한 사람이 준비를 취소했다가 다시 누른 것이면 창을 또 열지 않는다.
      // 그대로 다시 보고한다. 장치가 하나라도 빠졌으면 아래로 내려가 창을 연다.
      if (
        devices &&
        deviceReady(devices) &&
        motion?.lean &&
        motion.turn &&
        runtime.current?.ready(true)
      )
        return;
      await startAndReady();
    },
    [consent.consented, startAndReady, devices, motion],
  );
  // 점검 창은 준비를 누를 때만 열리고, 준비가 보고되면 스스로 닫힌다.
  const selfReady = snapshot?.roster?.players.find((p) => p.playerId === selfId)?.ready ?? false;
  useEffect(() => {
    if (selfReady) setDeviceCheck(false);
  }, [selfReady]);
  // 카메라와 얼굴 추적이 서면 중립 자세를 한 번 맞춘다. 누를 단추 없이 진행한다.
  const calibrating = useRef(false);
  useEffect(() => {
    if (!deviceCheck || !devices) return;
    if (devices.camera !== 'ready' || devices.vision !== 'ready') return;
    if (devices.calibration !== 'idle' || calibrating.current) return;
    calibrating.current = true;
    void runtime.current?.calibrateMotion().finally(() => {
      calibrating.current = false;
    });
  }, [deviceCheck, devices]);
  // 두 확인이 끝나면 준비를 보고한다. 소리 장치가 아직 잠겨 있어 거절되면 확인음으로 한 번
  // 풀고 다시 보고한다. 두 확인을 마친 사람이 단추를 더 누를 일은 없어야 한다.
  useEffect(() => {
    if (!deviceCheck || selfReady || !motion?.lean || !motion.turn) return;
    if (runtime.current?.ready(true)) return;
    void playTestTone().then(() => runtime.current?.ready(true));
  }, [deviceCheck, selfReady, motion, playTestTone]);
  // S15P21C204-295. 방 안에서도 Esc 는 같은 설정 창을 연다. 창은 홈과 하나다.
  const inRoom = Boolean(snapshot);
  // 창이 열리고 닫힐 때마다 미리보기가 붙을 자리를 옮긴다. 둘 다 화면 안에 있어야 한다.
  // S15P21C204-344. 탈출 자세를 잡는 동안에는 도전 쪽이 가져간다. 점검 창이 열려 있으면
  // 그쪽이 먼저다 — 점검 중에 경기 화면이 보일 일은 없다.
  const posing =
    snapshot?.view?.self?.status === 'ACTIVE' &&
    snapshot.view.self.challenge !== null &&
    snapshot.interaction.mode !== 'keyboard';
  useEffect(() => {
    if (!inRoom) return;
    runtime.current?.setPreviewHost(
      deviceCheck ? checkHost.current : (poseHost.current ?? facePump.current),
    );
  }, [inRoom, deviceCheck, posing]);
  useEffect(() => {
    if (!inRoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.repeat) setRoomMenu((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inRoom]);
  useEffect(() => {
    if (!inRoom) setRoomMenu(false);
  }, [inRoom]);
  // S15P21C204-295. 팀 연습의 할 일 목록. 내 시야가 바뀔 때마다 무엇을 해 봤는지 센다.
  const practicePhase = round?.phase === 'TEAM_PRACTICE';
  const [lessons, setLessons] = useState(EMPTY_LESSONS);
  useEffect(() => {
    if (!practicePhase) setLessons(EMPTY_LESSONS);
  }, [practicePhase]);
  useEffect(() => {
    if (!practicePhase) return;
    setLessons((current) => observeLessons(current, view));
  }, [practicePhase, view]);
  const interact = interactPrompt({
    view: view ?? null,
    tick: renderTick(),
    exchangeTarget: snapshot?.exchangeTarget,
  });
  // S15P21C204-276. 접히는 오버레이는 손이 필요한 일이 있을 때만 펼쳐진 채로 시작한다.
  const drawerUrgent =
    view?.self?.status === 'ACTIVE' &&
    (view.self.challenge !== null || view.self.exchange?.direction === 'incoming');
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
              : inLobby
                ? 'product-shell room-shell'
                : 'product-shell'
      }
    >
      <RoughDefs />
      {((!snapshot && !solo) || inLobby) && (
        <LobbyBackdrop paused={backgroundPaused} door={inLobby} />
      )}
      {!worldVisible && (
        <header>
          <BrandLogo />
          {/* 대기실에서는 왼쪽 줄에 설정·나가기가 있다. 머리말에 같은 단추를 또 두지 않는다. */}
          {snapshot && !inLobby && (
            <span className="room-head-actions">
              {/* 설정은 방 안에서도 한 창이다. Esc 로도 같은 창이 열린다. */}
              <button onClick={() => setRoomMenu(true)}>설정</button>
              <button className="quiet" onClick={leaveByChoice}>
                나가기
              </button>
            </span>
          )}
        </header>
      )}
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
          {/* 화면 품질은 설정 창(화면)에 있다. 방 안 어디서도 화면 위에 따로 띄우지 않는다. */}
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
              // 시작을 누르기 전까지 고를 수 있다. 자리가 다 차 장치 점검으로 넘어가도 같다.
              canChooseMapSize={['LOBBY', 'DEVICE_CHECK'].includes(round.phase)}
              mapSizeRequest={snapshot.requests.ROOM_MAP_SIZE}
              {...(snapshot.demo
                ? {
                    mapSizeNote:
                      '준비 완료를 누르기 전까지 고를 수 있습니다. 시연은 인형이 덜 걷는 15×15 가 빠릅니다.',
                  }
                : {})}
              onSelectMapSize={(size) =>
                runtime.current?.send({ type: 'ROOM_MAP_SIZE', payload: { size } })
              }
              onKick={(targetPlayerId) =>
                runtime.current?.send({ type: 'ROOM_KICK', payload: { targetPlayerId } })
              }
              ready={selfSeat?.ready ?? false}
              canReady={round.phase === 'DEVICE_CHECK' && !joining && !readying}
              readyHint={
                round.phase === 'LOBBY'
                  ? '자리가 다 차면 준비를 누를 수 있어요. 그때 카메라가 켜집니다.'
                  : undefined
              }
              onReady={(next) => void reportReady(next)}
              onStart={() => runtime.current?.send({ type: 'ROOM_START', payload: {} })}
              startRequest={snapshot.requests.ROOM_START}
              devices={lobbyDevices}
              faceOf={lobbyFace}
              pumpHost={holdPreview}
              onSettings={() => setRoomMenu(true)}
              onLeave={leaveByChoice}
              invite={
                // 시연 방은 /showcase 로 들어오고, 데모 방은 인형이 자리를 채운다. 초대가 없다.
                sessionCredential &&
                !snapshot.demo &&
                snapshot.roster?.hostId === selfId &&
                snapshot.roster?.kind !== 'showcase' ? (
                  <RoomInvitationControls
                    key={`${code}:${selfId}`}
                    sessionToken={sessionCredential}
                    roomCode={code}
                    teamOnly={access === 'gitlab-sso'}
                  />
                ) : undefined
              }
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
              rematchAvailable={snapshot.roster?.kind !== 'showcase'}
              capacity={snapshot.roster?.capacity ?? 6}
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
                  // 제한시간이 없는 데모 라운드는 null 이다. 시계가 지난 시간을 흘린다(332).
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
                {/* S15P21C204-295. 우상단 내 캐릭터 창. 상대가 보는 내 모습과 장치 단추 하나다.
                    설정 창이 열려 있는 동안에는 내려 둔다: 보이지 않는데 WebGL 한 장을 더
                    그리면 느린 기기에서 창 조작까지 밀린다. */}
                {activeSelf && !roomMenu && (
                  <SelfCorner
                    self={activeSelf}
                    devices={snapshot.devices}
                    busy={readying}
                    renderTick={renderTick}
                    faceStream={() => runtime.current?.processedFace() ?? null}
                    onCamera={() => {
                      if (consent.consented) void runtime.current?.startDevices(false);
                      else setConsentAsk(true);
                    }}
                    onCalibrate={() => void runtime.current?.calibrateMotion()}
                  />
                )}
                {/* S15P21C204-295. 팀 연습의 할 일 목록. 혼자 연습과 같은 목록을 무대 왼쪽에 둔다. */}
                {practicePhase && activeSelf && (
                  <PracticeQuests
                    role={activeSelf.role}
                    completed={lessons.completed}
                    canReady={deviceReady(snapshot.devices)}
                    request={snapshot.requests.PRACTICE_READY}
                    readyReported={snapshot.practiceReady}
                    onReady={() =>
                      runtime.current?.send({ type: 'PRACTICE_READY', payload: { ready: true } })
                    }
                  />
                )}
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
                      {/* 자세를 잡는 동안에만 실제 카메라 화면을 둔다. 캠코더 창은 상대가 보는
                          내 아바타라 프레이밍을 알 수 없다. 이 영상은 어디로도 전송되지 않는다. */}
                      {view.self?.status === 'ACTIVE' &&
                        view.self.challenge !== null &&
                        snapshot.interaction.mode !== 'keyboard' && (
                          <div
                            className="pose-preview"
                            ref={posePreview}
                            aria-label="내 웹캠 미리보기"
                          />
                        )}
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
                  onCancel={() => runtime.current?.cancelDemoScenario()}
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
          {roomMenu && (
            <aside className="settings-overlay" aria-label="설정">
              <SettingsWindow
                variant="overlay"
                eyebrow="설정"
                title="설정"
                initialTab="device"
                lead={{ label: '방 나가기', danger: true, run: () => void leave() }}
                tail={{ label: '닫기', run: () => setRoomMenu(false) }}
                tabs={[
                  {
                    id: 'device',
                    label: '조작 · 장치',
                    content: (
                      <LocalControls
                        status={snapshot.devices}
                        mode={snapshot.interaction.mode}
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
                        canRecover={
                          !!round &&
                          ['DEVICE_CHECK', 'TEAM_PRACTICE', 'PLAYING'].includes(round.phase)
                        }
                        variant="full"
                        bare
                      />
                    ),
                  },
                  {
                    id: 'sound',
                    label: '소리',
                    content: (
                      <AudioControls
                        readStatus={readAudio}
                        onPreferences={changeAudio}
                        onTestTone={playTestTone}
                        participants={snapshot.roster?.players.filter(
                          (player) => player.playerId !== selfId,
                        )}
                        canTestTone={
                          !!round && ['DEVICE_CHECK', 'TEAM_PRACTICE'].includes(round.phase)
                        }
                        bare
                      />
                    ),
                  },
                  {
                    id: 'display',
                    label: '화면',
                    content: (
                      <QualityControl
                        value={snapshot.quality}
                        onChange={(value) => runtime.current?.quality(value)}
                      />
                    ),
                  },
                ]}
              />
            </aside>
          )}
          {deviceCheck && round?.phase === 'DEVICE_CHECK' && (
            <div
              className="consent-ask device-check-ask"
              role="dialog"
              aria-modal="true"
              aria-label="장치 점검"
            >
              <div className="consent-ask-box device-check-ask-box">
                <ReadyCheck
                  status={snapshot.devices}
                  motion={snapshot.motionCheck}
                  previewHost={checkPreview}
                  onCancel={() => setDeviceCheck(false)}
                  onRetry={() => void startAndReady()}
                  extra={
                    /* 운영자 시연 방에만 있는 빠져나가는 길. 그 방은 장치 없이도 돌려 봐야 한다. */
                    demoRoom && !selfReady ? (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => runtime.current?.ready(true)}
                      >
                        점검 없이 준비 (데모)
                      </button>
                    ) : null
                  }
                />
              </div>
            </div>
          )}
          {consentAsk && (
            <div
              className="consent-ask"
              role="dialog"
              aria-modal="true"
              aria-label="카메라 사용 동의"
            >
              <div className="consent-ask-box">
                <ConsentGate
                  onAccept={() => {
                    consent.accept();
                    setConsentAsk(false);
                    // 대기실에서는 준비로 이어지고, 경기 중에는 카메라만 다시 켠다.
                    if (round?.phase === 'DEVICE_CHECK') void startAndReady();
                    else void runtime.current?.startDevices(false);
                  }}
                />
                <button type="button" className="quiet" onClick={() => setConsentAsk(false)}>
                  동의하지 않기
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
