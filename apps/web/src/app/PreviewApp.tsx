import { useState } from 'react';
import { WorkflowPreview } from './WorkflowPreview';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { MiniMap } from '../features/game/map/MiniMap';
import { LobbyScreen } from '../features/room/LobbyScreen';
import { viewFixture, roundFixture } from '../features/room/product-fixture';
import { DeviceCheckScreen } from '../features/game/flow/DeviceCheckScreen';
import { LoadingOverlay } from '../features/game/flow/LoadingOverlay';
import { ResultScreen } from '../features/game/flow/ResultScreen';
import { ConnectionLostScreen } from '../features/game/flow/ConnectionLostScreen';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
import { QualityControl } from '../features/game/flow/QualityControl';
import type { QualityPreset } from '../features/game/scene/quality-presets';
import { RenderPreview } from './RenderPreview';
const views = [
  '로비',
  '장치 점검',
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
export default function PreviewApp() {
  const [screen, setScreen] = useState<(typeof views)[number]>('로비');
  const [mounted, setMounted] = useState(true);
  const [quality, setQuality] = useState<QualityPreset>('medium');
  const view = viewFixture({
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
      {screen === '로비' && (
        <LobbyScreen
          roster={{
            matchId: 'm',
            stateVersion: 1,
            phase: 'LOBBY',
            hostId: 'self',
            players: [{ playerId: 'self', nickname: '시험 참가자', connected: true, ready: false }],
          }}
          selfId="self"
          roomCode="ABCDEF"
        />
      )}
      {screen === '장치 점검' && (
        <DeviceCheckScreen
          status={INITIAL_DEVICES}
          ready={false}
          onStart={async () => {}}
          onReady={() => {}}
          previewHost={() => {}}
        />
      )}
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
