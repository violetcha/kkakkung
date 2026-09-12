import { useState } from 'react';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import {
  RENDER_SCENES,
  renderFixture,
  type RenderScene,
} from '../features/game/scene/render-fixture';
import type { Dir } from '@kkakkung/protocol/game-schema';
import type { FrameMetrics } from '../features/game/scene/FrameMetrics';
import type { QualityPreset } from '../features/game/scene/quality-presets';

export function RenderPreview({ quality }: { quality: QualityPreset }) {
  const [scene, setScene] = useState<RenderScene>('복도');
  const [facing, setFacing] = useState<Dir>(0);
  const [tick, setTick] = useState(10);
  const [mounted, setMounted] = useState(true);
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null);
  return (
    <section className="render-preview">
      <h2>시설 공간 렌더 검수</h2>
      <p>
        합성 개인 뷰로 실제 제품 렌더러를 확인합니다. 실제 맵·카메라·Cloud·장치 성능 인수와는
        별도입니다.
      </p>
      <div className="actions">
        {RENDER_SCENES.map((name) => (
          <button key={name} aria-pressed={scene === name} onClick={() => setScene(name)}>
            {name}
          </button>
        ))}
        <label>
          바라보는 방향
          <select
            aria-label="바라보는 방향"
            value={facing}
            onChange={(event) => setFacing(Number(event.target.value) as Dir)}
          >
            {['북', '동', '남', '서'].map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          이동 시점 {tick}/20
          <input
            aria-label="이동 시점"
            type="range"
            min={0}
            max={20}
            value={tick}
            onChange={(event) => setTick(Number(event.target.value))}
          />
        </label>
        <button
          onClick={() => {
            setMounted(!mounted);
            setMetrics(null);
          }}
        >
          {mounted ? '렌더 해제' : '렌더 다시 열기'}
        </button>
      </div>
      {mounted && (
        <div className="product-canvas">
          <WorldCanvas
            view={renderFixture(scene, facing)}
            quality={quality}
            renderTick={() => tick}
            onMetrics={setMetrics}
          />
        </div>
      )}
      <output aria-label="렌더 측정">
        {metrics
          ? `${metrics.fps.toFixed(1)} FPS · 프레임 p95 ${metrics.p95Ms.toFixed(1)}ms · draw ${metrics.draws} · triangles ${metrics.triangles} · geometry ${metrics.geometries} · texture ${metrics.textures}`
          : '측정 대기'}
      </output>
    </section>
  );
}
