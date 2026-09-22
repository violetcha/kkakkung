import { useState } from 'react';
import { WorkflowPreview } from './WorkflowPreview';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { MiniMap } from '../features/game/map/MiniMap';
import { LobbyScreen } from '../features/room/LobbyScreen';
import { LobbyBackdrop } from '../features/room/LobbyBackdrop';
import { BrandLogo } from './BrandLogo';
import { viewFixture, roundFixture } from '../features/room/product-fixture';
import { DeviceCheckScreen } from '../features/game/flow/DeviceCheckScreen';
import { useMediaConsent } from '../features/room/use-media-consent';
import { LoadingOverlay } from '../features/game/flow/LoadingOverlay';
import { ResultScreen } from '../features/game/flow/ResultScreen';
import { ConnectionLostScreen } from '../features/game/flow/ConnectionLostScreen';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
import type { DeviceStatus } from '../features/input/InteractionRuntime';
import { QualityControl } from '../features/game/flow/QualityControl';
import type { QualityPreset } from '../features/game/scene/quality-presets';
import { RenderPreview } from './RenderPreview';
import { HudPreview } from './HudPreview';
// S15P21C204-273. 장치 점검 캐러셀 검수용 합성 상태. 실제 장치를 켜지 않는다.
const DEVICE_STAGES = {
  '점검 전': INITIAL_DEVICES,
  '카메라 통과': { ...INITIAL_DEVICES, camera: 'ready', vision: 'ready' },
  '자세 통과': {
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
  },
  '소리 통과': {
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
    audioPlayback: 'ready',
  },
  '보정 실패': {
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'failed',
    errorCode: 'CALIBRATION_NO_FACE',
  },
} as const satisfies Record<string, DeviceStatus>;

const views = [
  '로비',
  '장치 점검',
  '경기 HUD',
  '미로',
  '장비',
  '교환',
  '포즈',
  '키 도전',
  '연습',
  '로딩',
  '결과',
  '연결 상실',
  '렌더 검수',
] as const;
/** 미니맵 검수용 통로. 가로 한 줄과 세로 한 줄이 꺾여 만난다. */
const CORRIDOR = [
  ...Array.from({ length: 4 }, (_, i) => ({ x: 1 + i, y: 1 })),
  ...Array.from({ length: 4 }, (_, i) => ({ x: 4, y: 2 + i })),
  ...Array.from({ length: 3 }, (_, i) => ({ x: 2 + i, y: 4 })),
];

export default function PreviewApp() {
  const [screen, setScreen] = useState<(typeof views)[number]>('로비');
  const [mounted, setMounted] = useState(true);
  const [deviceStage, setDeviceStage] = useState<keyof typeof DEVICE_STAGES>('점검 전');
  const [quality, setQuality] = useState<QualityPreset>('medium');
  const consent = useMediaConsent();
  const view = viewFixture({
    // S15P21C204-277. 미니맵 검수용으로 통로 한 줄과 벽 몇 면을 알려 준 상태로 둔다.
    knownTerrain: [
      ...CORRIDOR.map((cell) => ({ ...cell, kind: 'floor' as const })),
      { x: 1, y: 1, side: 3, kind: 'wall' as const },
      { x: 1, y: 1, side: 0, kind: 'wall' as const },
      { x: 4, y: 1, side: 0, kind: 'wall' as const },
      { x: 4, y: 4, side: 1, kind: 'wall' as const },
      { x: 4, y: 4, side: 2, kind: 'wall' as const },
      { x: 2, y: 4, side: 2, kind: 'wall' as const },
    ],
    visibleCells: [
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ],
    visibleEntities: [
      { id: 'other', kind: 'player', cell: { x: 1, y: 0 }, dir: 2, action: null, role: 'runner' },
    ],
  });
  return (
    <main className="product-shell">
      <header>
        <h1>까꿍 화면 시험</h1>
      </header>
      <p>개발 전용 합성 fixture · 실제 경기·장치·미디어 검증이 아닙니다.</p>
      <nav className="actions" aria-label="시험 화면">
        {views.map((name) => (
          <button key={name} onClick={() => setScreen(name)}>
            {name}
          </button>
        ))}
      </nav>
      <QualityControl value={quality} onChange={setQuality} />
      {screen === '렌더 검수' && <RenderPreview quality={quality} />}
      {['장비', '교환', '포즈', '키 도전', '연습'].includes(screen) && (
        <WorkflowPreview key={screen} screen={screen} />
      )}
      {/* S15P21C204-295. 대기실은 한 화면이라 검수에서도 같은 껍데기로 본다. */}
      {screen === '로비' && (
        <div className="product-shell room-shell preview-room">
          <LobbyBackdrop paused door />
          <header>
            <BrandLogo />
          </header>
          <LobbyScreen
            roster={{
              matchId: 'm',
              stateVersion: 1,
              phase: 'LOBBY',
              hostId: 'self',
              // S15P21C204-295. 검수에서는 여섯 자리가 어떻게 보이는지 한 번에 본다.
              players: [
                { playerId: 'self', nickname: '시험 참가자', connected: true, ready: true },
                { playerId: 'p2', nickname: '친구1', connected: true, ready: true },
                { playerId: 'p3', nickname: '친구2', connected: true, ready: false },
                { playerId: 'p4', nickname: '친구3', connected: false, ready: true },
                { playerId: 'p5', nickname: '친구4', connected: true, ready: true },
                { playerId: 'p6', nickname: '친구5', connected: true, ready: false },
              ],
            }}
            selfId="self"
            roomCode="ABCDEF"
            ready
            canReady
            onReady={() => {}}
            onSettings={() => {}}
            onLeave={() => {}}
            invite={<p>초대 링크가 표시되는 자리입니다.</p>}
            devices={[
              { label: '웹캠', state: '준비됨' },
              { label: '얼굴 추적', state: '준비됨' },
              { label: '중립 자세 보정', state: '꺼짐' },
              { label: '마이크', state: '사용 안 함' },
            ]}
          />
        </div>
      )}
      {screen === '장치 점검' && (
        <>
          <label>
            검수 상태{' '}
            <select
              data-testid="device-stage"
              value={deviceStage}
              onChange={(event) =>
                setDeviceStage(event.currentTarget.value as keyof typeof DEVICE_STAGES)
              }
            >
              {Object.keys(DEVICE_STAGES).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {/* 합성 미리보기라도 실제 진입 계약과 같은 동의 게이트를 거친다. */}
          <DeviceCheckScreen
            key={deviceStage}
            status={DEVICE_STAGES[deviceStage]}
            ready={false}
            onStart={async () => {}}
            onReady={() => {}}
            onCalibrate={async () => {}}
            onMicrophone={async () => {}}
            onTestTone={async () => 'played' as const}
            consented={consent.consented}
            onConsent={consent.accept}
            motion={
              DEVICE_STAGES[deviceStage].calibration === 'ready'
                ? { lean: true, turn: true }
                : { lean: false, turn: false }
            }
            previewHost={() => {}}
          />
        </>
      )}
      {screen === '경기 HUD' && <HudPreview />}
      {screen === '미로' && (
        <>
          <button onClick={() => setMounted(!mounted)}>
            {mounted ? '장면 해제' : '장면 열기'}
          </button>
          {mounted && (
            <section className="product-stage">
              <div className="product-canvas">
                <WorldCanvas view={view} quality={quality} />
              </div>
              <MiniMap view={view} />
            </section>
          )}
        </>
      )}
      {screen === '로딩' && (
        <LoadingOverlay
          round={roundFixture({ phase: 'COUNTDOWN', startAt: 3000 })}
          serverNow={1000}
        />
      )}
      {screen === '결과' && (
        <ResultScreen
          round={roundFixture({ phase: 'ABORTED', abortReason: 'MEDIA_POLICY_UNCERTAIN' })}
          self={null}
          host={false}
          connectedCount={6}
          onRematch={() => {}}
        />
      )}
      {screen === '연결 상실' && <ConnectionLostScreen onLeave={() => setScreen('로비')} />}
    </main>
  );
}
