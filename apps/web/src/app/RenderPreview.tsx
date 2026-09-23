import { useCallback, useMemo, useRef, useState } from 'react';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import {
  RENDER_SCENES,
  SELF_MOTIONS,
  TARGET_FACINGS,
  renderFixture,
  type RenderScene,
  type SelfMotion,
  type TargetFacing,
} from '../features/game/scene/render-fixture';
import type { Dir } from '@kkakkung/protocol/game-schema';
import type { FrameMetrics } from '../features/game/scene/FrameMetrics';
import type { QualityPreset } from '../features/game/scene/quality-presets';
import {
  SCENE_THEME_IDS,
  SCENE_THEME_LABELS,
  rememberSceneTheme,
  resolveSceneTheme,
  type SceneThemeId,
} from '../features/game/scene/scene-theme';
import { visibilityMask } from '../features/game/scene/visibility-mask';
import type { AvatarRenderState, AvatarStateReporter } from '../features/game/scene/RoleAvatar';

export function RenderPreview({ quality }: { quality: QualityPreset }) {
  const [scene, setScene] = useState<RenderScene>('출구·장비');
  const [theme, setTheme] = useState<SceneThemeId>(() => resolveSceneTheme());
  const [facing, setFacing] = useState<Dir>(0);
  const [tick, setTick] = useState(10);
  const [selfMotion, setSelfMotion] = useState<SelfMotion>('still');
  const [targetFacing, setTargetFacing] = useState<TargetFacing>('front');
  const [mounted, setMounted] = useState(true);
  const [metrics, setMetrics] = useState<FrameMetrics | null>(null);
  const view = useMemo(
    () => renderFixture(scene, facing, selfMotion, targetFacing),
    [facing, scene, selfMotion, targetFacing],
  );
  const playerIds = useMemo(
    () => new Set(visibilityMask(view).players.map((player) => player.id)),
    [view],
  );
  const playerIdsRef = useRef(playerIds);
  playerIdsRef.current = playerIds;
  const reviewKey = `${scene}:${quality}`;
  const [avatarReport, setAvatarReport] = useState<{
    key: string;
    states: ReadonlyMap<string, AvatarRenderState>;
  }>(() => ({ key: reviewKey, states: new Map() }));
  const reportAvatarState = useCallback<AvatarStateReporter>(
    (playerId, state) => {
      if (!playerIdsRef.current.has(playerId)) return;
      setAvatarReport((previous) => {
        const states = new Map(previous.key === reviewKey ? previous.states : []);
        if (state === 'removed') states.delete(playerId);
        else states.set(playerId, state);
        return { key: reviewKey, states };
      });
    },
    [reviewKey],
  );
  const avatarStates = avatarReport.key === reviewKey ? avatarReport.states : new Map();
  const readyAvatars = [...playerIds].filter((id) => avatarStates.get(id) === 'ready').length;
  const fallbackAvatars = [...playerIds].filter((id) => avatarStates.get(id) === 'fallback').length;
  return (
    <section className="render-preview">
      <h2>공간 렌더 검수</h2>
      <p>
        합성 개인 뷰로 실제 제품 렌더러를 확인합니다. 실제 맵·카메라·Cloud·장치 성능 인수와는
        별도입니다. 어두운 블록 테마에서는 시야 끝(3칸)의 상대 식별과 출구 인지, 든 도구를 함께
        봅니다.
      </p>
      <div className="actions">
        <label>
          렌더 테마
          <select
            aria-label="렌더 테마"
            value={theme}
            onChange={(event) => {
              const next = event.target.value as SceneThemeId;
              setTheme(next);
              rememberSceneTheme(next);
            }}
          >
            {SCENE_THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {SCENE_THEME_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
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
          내 동작
          <select
            aria-label="내 동작"
            value={selfMotion}
            onChange={(event) => setSelfMotion(event.target.value as SelfMotion)}
          >
            {SELF_MOTIONS.map((motion) => (
              <option key={motion} value={motion}>
                {{ still: '없음', turn: '회전', move: '이동' }[motion]}
              </option>
            ))}
          </select>
        </label>
        <label>
          상대 방향
          <select
            aria-label="상대 방향"
            value={targetFacing}
            onChange={(event) => setTargetFacing(event.target.value as TargetFacing)}
          >
            {TARGET_FACINGS.map((direction) => (
              <option key={direction} value={direction}>
                {direction === 'front' ? '정면' : '측면'}
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
            view={view}
            quality={quality}
            theme={theme}
            renderTick={() => tick}
            onMetrics={setMetrics}
            onAvatarState={reportAvatarState}
          />
        </div>
      )}
      <output aria-label="렌더 측정">
        {metrics
          ? `${metrics.fps.toFixed(1)} FPS · 프레임 p95 ${metrics.p95Ms.toFixed(1)}ms · draw ${metrics.draws} · triangles ${metrics.triangles} · geometry ${metrics.geometries} · texture ${metrics.textures} · program ${metrics.programs}`
          : '측정 대기'}
      </output>
      <output aria-label="아바타 로딩">
        {`준비 ${readyAvatars}/${playerIds.size} · 대체 ${fallbackAvatars}`}
      </output>
    </section>
  );
}
