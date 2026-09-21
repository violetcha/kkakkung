import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalControls } from '../flow/LocalControls';
import { DeviceCheckScreen } from '../flow/DeviceCheckScreen';
import { AudioControls } from '../flow/AudioControls';
import type { AudioPreferences } from '../../media/audio-preferences';
import { WorldCanvas } from '../scene/WorldCanvas';
import { KeyChallenge } from '../pose/KeyChallenge';
import { POSE_LABELS } from '../pose/PoseChallenge';
import { useMediaConsent } from '../../room/use-media-consent';
import { createSoloSession, type SoloSnapshot } from './solo-session';
import { LESSONS } from './solo-world';
import { SoloPracticeHud } from './SoloPracticeHud';
// 진단 오버레이(제거 가능): 아래 두 import 와 DebugOverlay 마운트·토글·단축키만 지우면 된다.
import { DebugOverlay } from '../../debug/DebugOverlay';
import { debugFeed, installDebugShortcut, useDebugOverlayEnabled } from '../../debug/debug-feed';

export function SoloPracticeScreen({ onExit }: { onExit(): void }) {
  const session = useRef<ReturnType<typeof createSoloSession> | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const debugOverlay = useDebugOverlayEnabled();
  useEffect(() => installDebugShortcut(window), []);
  const [snapshot, setSnapshot] = useState<SoloSnapshot | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  // S15P21C204-292. 개인 체험도 같은 장치를 켠다. 방과 같은 동의를 같은 방식으로 받는다.
  const consent = useMediaConsent();
  const [busy, setBusy] = useState(false);
  const [microphone, setMicrophone] = useState(false);
  const [error, setError] = useState('');
  const recordingStartedAtMs = useRef(Date.now());
  const readAudio = useCallback(() => session.current?.getLocalAudioStatus() ?? null, []);
  const changeAudio = useCallback(
    (value: AudioPreferences) => session.current?.setAudioPreferences(value),
    [],
  );
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
    setSnapshot(current.snapshot());
    current.setPageActive(document.hasFocus() && document.visibilityState === 'visible');
    const timer = window.setInterval(() => current.poll(), 80);
    const focus = () => current.setPageActive(document.visibilityState === 'visible');
    const blur = () => current.setPageActive(false);
    const hidden = () => {
      if (document.visibilityState === 'hidden')
        void stop('다른 탭으로 이동해 카메라와 체험을 종료했어요.');
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
  const renderTick = useCallback(() => performance.now() / 50, []);
  const key = useCallback(
    (value: Parameters<ReturnType<typeof createSoloSession>['key']>[0], repeat?: boolean) =>
      session.current?.key(value, repeat),
    [],
  );
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
  return (
    <section className="solo-practice" aria-label="혼자 조작 체험">
      <div className="solo-heading">
        <div>
          <p className="eyebrow">친구들을 기다리는 동안</p>
          <h2>혼자 준비해 볼까요?</h2>
        </div>
        <button className="quiet" disabled={closing} onClick={() => void stop()}>
          {closing ? '장치 정리 중…' : '체험 마치고 방 준비하기'}
        </button>
      </div>
      <p>
        먼저 W/S로 앞뒤 이동, A/D로 좌우 회전을 해 보세요. 카메라는 버튼을 누른 뒤 켜집니다. 이
        체험의 영상·음성은 다른 참가자에게 전송되지 않습니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {stopped ? (
        <div className="game-panel">
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
        </div>
      ) : (
        snapshot && (
          <>
            <div className="solo-layout">
              <div className="solo-stage">
                <div className="product-canvas">
                  <WorldCanvas
                    view={snapshot.view}
                    renderTick={renderTick}
                    ownerNames={{ 'solo-self': '나' }}
                    quality="low"
                  />
                </div>
                <SoloPracticeHud
                  view={snapshot.view}
                  tick={snapshot.tick}
                  selected={snapshot.interaction.selectedEquipment}
                  startedAtMs={recordingStartedAtMs.current}
                />
              </div>
              <div>
                <LocalControls
                  compact
                  status={snapshot.devices}
                  mode={snapshot.interaction.mode}
                  previewHost={preview}
                  onKeyboard={() => session.current?.selectKeyboard()}
                  onMotion={async () => {
                    await session.current?.calibrateMotion();
                  }}
                  onRecover={() => start()}
                  onMicrophone={async (value) => {
                    setMicrophone(value);
                    await session.current?.microphone(value);
                  }}
                  consented={consent.consented}
                  canRecover={!closing && !busy}
                />
                {debugOverlay && <DebugOverlay host={hostElement} />}
                <AudioControls
                  readStatus={readAudio}
                  onPreferences={changeAudio}
                  onTestTone={playTestTone}
                  canTestTone={!closing}
                />
                <DeviceCheckScreen
                  heading="체험 전 장치 점검"
                  status={snapshot.devices}
                  motion={snapshot.motionCheck}
                  onStart={start}
                  onCalibrate={async () => {
                    await session.current?.calibrateMotion();
                  }}
                  onMicrophone={async (enabled) => {
                    setMicrophone(enabled);
                    await session.current?.microphone(enabled);
                  }}
                  onTestTone={playTestTone}
                  consented={consent.consented}
                  onConsent={consent.accept}
                />
                <p>
                  현재 조작:{' '}
                  <strong>
                    {snapshot.interaction.mode === 'keyboard' ? '키보드' : '얼굴·상체 모션'}
                  </strong>
                </p>
                {snapshot.interaction.mode === 'motion' && (
                  <button onClick={() => session.current?.selectKeyboard()}>
                    키보드로 계속 체험
                  </button>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={debugOverlay}
                    onChange={(event) => debugFeed.setEnabled(event.target.checked)}
                  />{' '}
                  추적 디버그 표시 (Ctrl+Shift+D)
                </label>
                <p>
                  정면을 보고 얼굴과 양쪽 어깨를 카메라 안에 두세요. 카메라 없이도 키보드 체험은
                  가능합니다. 실제 경기를 시작하려면 카메라가 필요합니다.
                </p>
              </div>
            </div>
            <div className="solo-lessons">
              <div className="game-panel">
                <h3>조작 성공 기록</h3>
                <ul aria-label="체험 진행">
                  {Object.entries(LESSONS).map(([id, label]) => (
                    <li
                      key={id}
                      data-completed={snapshot.completed.includes(id as keyof typeof LESSONS)}
                    >
                      {snapshot.completed.includes(id as keyof typeof LESSONS)
                        ? '✓ 완료 · '
                        : '○ 연습 · '}
                      {label}
                    </li>
                  ))}
                </ul>
                <p>
                  W/S: 전진·후진 · A/D: 좌우 90° 회전. 옆으로 이동하는 키가 아닙니다. 키를 놓거나
                  몸을 중립으로 돌리고 잠시 멈춰 보세요. 모션 회전은 정면으로 돌아온 뒤 다시 고개를
                  돌립니다.
                </p>
              </div>
              <div className="game-panel">
                <h3>역할 행동 배우기</h3>
                <div className="actions">
                  <button onClick={() => session.current?.lesson('runner')}>도망자 체험</button>
                  <button onClick={() => session.current?.lesson('tagger')}>술래 체험</button>
                </div>
                <p>역할을 고르면 연습 위치로 이동합니다.</p>
                <p role="status">{snapshot.message}</p>
                {snapshot.self.role === 'tagger' && (
                  <p>
                    선택 장비:{' '}
                    {snapshot.interaction.selectedEquipment === 'sensor' ? '감지기' : '덫'} · 1/2로
                    선택, F로 설치·취소
                  </p>
                )}
                {snapshot.self.role === 'runner' && snapshot.exitId && !snapshot.self.challenge && (
                  <button
                    onClick={() =>
                      session.current?.command({
                        type: 'EXIT_START',
                        payload: { exitId: snapshot.exitId! },
                      })
                    }
                  >
                    탈출 도전 시작 · E
                  </button>
                )}
                {snapshot.self.challenge &&
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
                      <p>
                        자세를 1.2초 유지하세요. Esc로 취소하거나 키보드 조작으로 전환할 수
                        있습니다.
                      </p>
                      <progress aria-label="체험 자세 유지" max={1} value={snapshot.poseProgress} />
                    </div>
                  ))}
              </div>
            </div>
            <p>
              체험 기록·지도·장비는 실제 경기에 이어지지 않습니다. 체험을 마치면 카메라를 끄고, 여섯
              명이 모인 뒤 장치 점검과 팀 연습을 새로 진행합니다.
            </p>
          </>
        )
      )}
    </section>
  );
}
