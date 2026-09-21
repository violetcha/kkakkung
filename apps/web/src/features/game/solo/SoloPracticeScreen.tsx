import { useCallback, useEffect, useRef, useState } from 'react';
import { DevicePane } from './DevicePane';
import { SettingsWindow } from '../flow/SettingsWindow';
import { ControlsPane, DisplayPane, SoundPane } from '../flow/SettingsPanes';
import { DEFAULT_AUDIO_PREFERENCES } from '../../media/audio-preferences';
import {
  DEFAULT_HOME_SETTINGS,
  loadHomeSettings,
  saveHomeSettings,
  type HomeSettings,
} from '../../room/home-settings';
import { ConsentGate } from '../../room/ConsentGate';
import { useMediaConsent } from '../../room/use-media-consent';
import { AudioControls } from '../flow/AudioControls';
import type { AudioPreferences } from '../../media/audio-preferences';
import type { Role } from '@kkakkung/protocol/game-schema';
import { WorldCanvas } from '../scene/WorldCanvas';
import { KeyChallenge } from '../pose/KeyChallenge';
import { POSE_LABELS } from '../pose/PoseChallenge';
import { createSoloSession, type SoloSnapshot } from './solo-session';
import { LESSONS, type Lesson } from './solo-world';
import { SoloPracticeHud } from './SoloPracticeHud';
import { SelfAvatarView } from './SelfAvatarView';
import { MotionGauges } from './MotionGauges';
import { StaticNoise } from './StaticNoise';
// 진단 오버레이(제거 가능): 아래 두 import 와 DebugOverlay 마운트·토글·단축키만 지우면 된다.
import { DebugOverlay } from '../../debug/DebugOverlay';
import { debugFeed, installDebugShortcut, useDebugOverlayEnabled } from '../../debug/debug-feed';

/**
 * 튜토리얼 순서. 이동 다섯 개는 역할과 상관없이 보이고, 마지막 하나는 지금 역할의 것만 보인다.
 * 완료 판정(LESSONS)은 순서와 무관하고, 화면에서 다음 할 일만 이 순서로 고른다.
 */
const COMMON_QUESTS = [
  'forward',
  'back',
  'neutral',
  'left',
  'right',
] as const satisfies readonly Lesson[];
const ROLE_QUEST: Record<Role, Lesson> = { runner: 'runner', tagger: 'tagger' };
const QUEST_KEYS: Record<Lesson, string> = {
  forward: 'W',
  back: 'S',
  neutral: '키 놓기',
  left: 'A',
  right: 'D',
  tagger: 'F',
  runner: 'E',
};

/** 캠코더. 카메라를 아직 켜지 않았을 때. 작은 크기에서 알아볼 수 있게 몸통·렌즈만 남겼다. */
const CameraIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="2" y="6.5" width="14" height="11" rx="0.5" />
    <path d="M16 12l6-3.5v7z" />
    <circle cx="9" cy="12" r="3" />
  </svg>
);
/** 두 선 사이에 선 사람. 중립 자세 보정. */
const PostureIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.5 3.5v17M20.5 3.5v17" />
    <circle cx="12" cy="7" r="2.5" />
    <path d="M12 9.5v11M7.5 13h9" />
  </svg>
);

export function SoloPracticeScreen({ onExit }: { onExit(): void }) {
  const session = useRef<ReturnType<typeof createSoloSession> | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const debugOverlay = useDebugOverlayEnabled();
  useEffect(() => installDebugShortcut(window), []);
  const [snapshot, setSnapshot] = useState<SoloSnapshot | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [microphone, setMicrophone] = useState(false);
  const [error, setError] = useState('');
  const recordingStartedAtMs = useRef(Date.now());
  // S15P21C204-295. 게임처럼 무대가 화면 전체를 차지하고, 안내·장치·기록은 Esc 메뉴에 둔다.
  const [menuOpen, setMenuOpen] = useState(false);
  const challengeActive = useRef(false);
  const settingsRef = useRef<HomeSettings>(DEFAULT_HOME_SETTINGS);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      // 탈출 도전 중 Esc 는 도전 취소가 먼저다(입력 런타임이 처리).
      if (challengeActive.current) return;
      setMenuOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // S15P21C204-295. 설정 저장소는 홈과 하나다. 여기서 바꾼 값도 바로 저장되고 다음 판에 이어진다.
  const [settings, setSettings] = useState<HomeSettings>(() => loadHomeSettings());
  const updateSettings = useCallback((patch: Partial<HomeSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveHomeSettings(next);
      session.current?.setAudioPreferences({
        ...DEFAULT_AUDIO_PREFERENCES,
        volume: next.volume,
        muted: next.muted,
      });
      return next;
    });
  }, []);
  const readAudio = useCallback(() => session.current?.getLocalAudioStatus() ?? null, []);
  const changeAudio = useCallback((value: AudioPreferences) => {
    session.current?.setAudioPreferences(value);
    setSettings((current) => {
      const next = { ...current, volume: value.volume, muted: value.muted };
      saveHomeSettings(next);
      return next;
    });
  }, []);
  const playTestTone = useCallback(
    async () => (await session.current?.playTestTone()) ?? 'unavailable',
    [],
  );
  const stop = useCallback(
    async (reason?: string) => {
      const current = session.current;
      setClosing(true);
      try {
        await current?.dispose();
        if (session.current !== current) return;
        setBusy(false);
        if (reason) setStopped(reason);
        else onExit();
      } catch {
        setError(
          '장치 정리를 확인하지 못했습니다. 카메라 표시등을 확인하고 페이지를 새로고침해 주세요.',
        );
      } finally {
        if (session.current === current) setClosing(false);
      }
    },
    [onExit],
  );
  useEffect(() => {
    if (stopped) return;
    let active = true;
    const current = createSoloSession({
      now: () => performance.now(),
      changed: (value) => {
        if (active) setSnapshot(value);
      },
    });
    session.current = current;
    current.setPreviewHost(host.current);
    current.setAudioPreferences({
      ...DEFAULT_AUDIO_PREFERENCES,
      volume: settingsRef.current.volume,
      muted: settingsRef.current.muted,
    });
    setSnapshot(current.snapshot());
    current.setPageActive(document.hasFocus() && document.visibilityState === 'visible');
    const timer = window.setInterval(() => current.poll(), 80);
    const focus = () => current.setPageActive(document.visibilityState === 'visible');
    const blur = () => current.setPageActive(false);
    // S15P21C204-295. Alt+Tab·다른 탭으로 잠깐 나가도 체험은 유지한다(입력만 멈춤). 이 체험의
    // 영상·음성은 어디로도 전송되지 않으므로 탭을 숨긴 동안 카메라가 켜져 있어도 새어 나갈 곳이 없다.
    // 페이지를 떠나면(pagehide) 그때 정리한다.
    const hidden = () => {
      current.setPageActive(document.visibilityState === 'visible' && document.hasFocus());
    };
    const pagehide = () => {
      void stop('화면 이동으로 체험을 종료했어요.');
    };
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', hidden);
      if (session.current === current) session.current = null;
      void current.dispose().catch(() => {});
    };
  }, [stopped, stop]);
  const preview = useCallback((element: HTMLDivElement | null) => {
    host.current = element;
    setHostElement(element);
    session.current?.setPreviewHost(element);
  }, []);
  settingsRef.current = settings;
  const renderTick = useCallback(() => performance.now() / 50, []);
  const faceStream = useCallback(() => session.current?.processedFace() ?? null, []);
  const key = useCallback(
    (value: Parameters<ReturnType<typeof createSoloSession>['key']>[0], repeat?: boolean) =>
      session.current?.key(value, repeat),
    [],
  );
  // S15P21C204-292/295. 카메라를 켜는 길은 무대 우상단 아이콘과 장치 갈래의 줄 둘이다. 둘 다
  // 이 문을 지난다. 알림이 아니라 확인 창이어야 한다: 뜨기만 하고 지나가면 동의 없이 켜진다.
  // 동의 상태는 화면마다 따로 기억하지 않는다(S15P21C204-292). 이 화면은 언제 물을지만 정한다.
  const consent = useMediaConsent();
  const [asking, setAsking] = useState(false);
  const requestCamera = () => {
    if (consent.consented) void start();
    else setAsking(true);
  };
  const start = async (wantMicrophone = microphone) => {
    const current = session.current;
    setMicrophone(wantMicrophone);
    setBusy(true);
    setError('');
    try {
      await current?.startDevices(wantMicrophone);
    } catch {
      if (session.current === current)
        setError('장치 점검을 마치지 못했습니다. 권한을 확인하고 다시 시도하세요.');
    } finally {
      if (session.current === current) setBusy(false);
    }
  };
  challengeActive.current = Boolean(snapshot?.self.challenge);
  // 우상단 버튼 하나가 장치 점검(Esc 메뉴)의 두 동작을 잇는다. 카메라를 켜면 같은 자리에서
  // 중립 자세 보정으로 바뀌고, 보정까지 끝나면 다시 보정할 수 있다.
  const cameraState = snapshot?.devices.camera ?? 'idle';
  const calibration = snapshot?.devices.calibration ?? 'idle';
  const camera: {
    state: string;
    label: string;
    icon: typeof CameraIcon;
    disabled: boolean;
    run(): void;
  } =
    busy || cameraState === 'requesting'
      ? {
          state: 'busy',
          label: '카메라 연결 중',
          icon: CameraIcon,
          disabled: true,
          run: () => {},
        }
      : cameraState !== 'ready'
        ? {
            state: cameraState === 'failed' ? 'failed' : 'idle',
            label: cameraState === 'failed' ? '카메라 다시 연결' : '카메라 연결',
            icon: CameraIcon,
            disabled: false,
            run: requestCamera,
          }
        : calibration === 'running'
          ? {
              state: 'busy',
              label: '중립 자세 보정 중',
              icon: PostureIcon,
              disabled: true,
              run: () => {},
            }
          : {
              state:
                calibration === 'ready' ? 'ready' : calibration === 'failed' ? 'failed' : 'idle',
              label: calibration === 'ready' ? '중립 자세 다시 보정' : '중립 자세 보정',
              icon: PostureIcon,
              disabled: false,
              run: () => void session.current?.calibrateMotion(),
            };
  const role: Role = snapshot?.self.role ?? 'runner';
  const quests: readonly Lesson[] = [...COMMON_QUESTS, ROLE_QUEST[role]];
  const questsDone = quests.filter((id) => snapshot?.completed.includes(id)).length;
  const nextQuest = quests.find((id) => !snapshot?.completed.includes(id)) ?? null;
  const challenge =
    snapshot?.self.challenge &&
    (snapshot.interaction.mode === 'keyboard' ? (
      <KeyChallenge
        local
        challenge={snapshot.self.challenge}
        index={snapshot.keyIndex}
        tick={snapshot.tick}
        onKey={key}
        onCancel={() =>
          session.current?.command({
            type: 'EXIT_CANCEL',
            payload: { challengeId: snapshot.self.challenge!.challengeId },
          })
        }
      />
    ) : (
      <div>
        <h4>{POSE_LABELS[snapshot.self.challenge.poseKind]}</h4>
        <p>자세를 1.2초 유지하세요. Esc로 취소하거나 키보드 조작으로 전환할 수 있습니다.</p>
        <progress aria-label="체험 자세 유지" max={1} value={snapshot.poseProgress} />
      </div>
    ));
  return (
    <section
      className="solo-practice"
      aria-label="혼자 조작 체험"
      data-menu={menuOpen ? 'open' : 'closed'}
    >
      {stopped ? (
        <div className="solo-stopped game-panel">
          <p role="status">{stopped}</p>
          <button
            disabled={closing}
            onClick={() => {
              recordingStartedAtMs.current = Date.now();
              setSnapshot(null);
              setError('');
              setMicrophone(false);
              setStopped(null);
            }}
          >
            새 체험 시작하기
          </button>
          <button className="quiet" disabled={closing} onClick={() => void stop()}>
            체험 마치기
          </button>
        </div>
      ) : (
        snapshot && (
          <>
            <div className="solo-stage">
              <div className="product-canvas">
                <WorldCanvas
                  view={snapshot.view}
                  renderTick={renderTick}
                  ownerNames={{ 'solo-self': '나' }}
                  quality="low"
                  paused={menuOpen}
                />
              </div>
              <SoloPracticeHud
                view={snapshot.view}
                tick={snapshot.tick}
                selected={snapshot.interaction.selectedEquipment}
                startedAtMs={recordingStartedAtMs.current}
              />
              {/* 도전 진행은 메뉴가 닫혀 있어도 무대 위에 보인다. */}
              {challenge && <div className="solo-challenge">{challenge}</div>}
              {/* 우상단: 상대가 보는 내 캐릭터와 앞뒤·좌우 게이지, 그 아래 카메라 연결.
                  멈춘 동안에는 내려 둔다. 보이지 않는데 WebGL 한 장을 더 그리면 느린 기기에서
                  설정 창 클릭까지 밀린다(CI SwiftShader 에서 실제로 밀렸다). */}
              {!menuOpen && (
                <div className="solo-corner">
                  <div className="solo-self" aria-hidden="true">
                    <SelfAvatarView
                      self={snapshot.self}
                      renderTick={renderTick}
                      faceStream={faceStream}
                    />
                    <StaticNoise />
                    <MotionGauges />
                  </div>
                  <button
                    type="button"
                    className="solo-camera-button"
                    data-state={camera.state}
                    disabled={camera.disabled}
                    onClick={camera.run}
                    aria-label={camera.label}
                    title={camera.label}
                  >
                    {camera.icon}
                  </button>
                </div>
              )}
              {/* 좌중단: 역할 토글은 튜토리얼 박스 밖 위에, 퀘스트는 그 역할의 것만. */}
              <div className="solo-tutorial">
                <div className="solo-role-toggle" role="group" aria-label="역할 전환">
                  <button
                    type="button"
                    aria-pressed={role === 'runner'}
                    onClick={() => session.current?.lesson('runner')}
                  >
                    도망자 체험
                  </button>
                  <button
                    type="button"
                    aria-pressed={role === 'tagger'}
                    onClick={() => session.current?.lesson('tagger')}
                  >
                    술래 체험
                  </button>
                </div>
                <section className="solo-quests" aria-label="체험 진행">
                  <header>
                    <span className="solo-quests-kicker">튜토리얼</span>
                    <span className="solo-quests-count">
                      {questsDone} / {quests.length}
                    </span>
                  </header>
                  <ol>
                    {quests.map((id) => {
                      const completed = snapshot.completed.includes(id);
                      return (
                        <li
                          key={id}
                          data-completed={completed}
                          data-current={!completed && id === nextQuest}
                        >
                          <span className="solo-quest-mark">{completed ? '✓' : ''}</span>
                          <span className="solo-quest-label">{LESSONS[id]}</span>
                          <kbd>{QUEST_KEYS[id]}</kbd>
                        </li>
                      );
                    })}
                  </ol>
                  {nextQuest === null && (
                    <p className="solo-quests-done">
                      모두 끝났어요. Esc 메뉴에서 체험을 마칠 수 있어요.
                    </p>
                  )}
                </section>
              </div>
            </div>
            <aside className="solo-menu" aria-label="체험 메뉴" hidden={!menuOpen}>
              <SettingsWindow
                variant="overlay"
                eyebrow="일시정지"
                title="혼자 준비해 볼까요?"
                subtitle="친구들을 기다리는 동안 조작과 장치를 확인해요. 여기서 한 것은 실제 경기에 이어지지 않아요."
                initialTab="device"
                lead={{ label: '계속하기', run: () => setMenuOpen(false) }}
                tail={{ label: '체험 마치기', disabled: closing, run: () => void stop() }}
                footer={
                  <>
                    <kbd>Esc</kbd> 눌러 체험으로 돌아가기
                  </>
                }
                alert={
                  error ? (
                    <p role="alert" className="error pause-error">
                      {error}
                    </p>
                  ) : null
                }
                tabs={[
                  {
                    id: 'controls',
                    label: '조작',
                    content: (
                      <ControlsPane
                        role={role}
                        mode={snapshot.interaction.mode}
                        onKeyboard={() => session.current?.selectKeyboard()}
                        status={snapshot.message}
                      />
                    ),
                  },
                  {
                    id: 'display',
                    label: '화면',
                    content: (
                      <DisplayPane
                        settings={settings}
                        onChange={updateSettings}
                        debugOverlay={debugOverlay}
                        onDebugOverlay={(value) => debugFeed.setEnabled(value)}
                        applied="체험 화면은 가볍게 고정이라 화면 품질은 실제 경기에 입장할 때 적용됩니다."
                      />
                    ),
                  },
                  {
                    id: 'sound',
                    label: '소리',
                    content: (
                      <SoundPane
                        settings={settings}
                        onChange={updateSettings}
                        live={
                          <AudioControls
                            sections="live"
                            readStatus={readAudio}
                            onPreferences={changeAudio}
                            onTestTone={playTestTone}
                            canTestTone={!closing}
                          />
                        }
                      />
                    ),
                  },
                  {
                    id: 'device',
                    label: '카메라 · 장치',
                    content: (
                      <>
                        <DevicePane
                          status={snapshot.devices}
                          previewHost={preview}
                          busy={busy}
                          canAct={!closing}
                          onStart={requestCamera}
                          onCalibrate={() => void session.current?.calibrateMotion()}
                          onMicrophone={(enabled) => {
                            setMicrophone(enabled);
                            void session.current?.microphone(enabled);
                          }}
                        />
                        {debugOverlay && <DebugOverlay host={hostElement} />}
                      </>
                    ),
                  },
                ]}
              />
            </aside>
            {asking && (
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
                      setAsking(false);
                      void start();
                    }}
                  />
                  <button
                    type="button"
                    className="quiet"
                    disabled={closing}
                    onClick={() => {
                      setAsking(false);
                      void stop();
                    }}
                  >
                    동의하지 않고 나가기
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
