import { useEffect, useRef } from 'react';
import type { Cell, PrivateView } from '@kkakkung/protocol/game-schema';
import { mapDrawModel } from './map-draw-model';
import { pastEventMarkers, type HunterMarker } from './past-event-markers';
import { exitOwnerLabel, type OwnerNames } from '../scene/ExitOwnerLabel';
import { drawMinimap } from './minimap-render';

export function MiniMap({
  view,
  ownerNames = {},
  markers = [],
  tick = 0,
  windowCells,
  renderTick,
  operatorExit = null,
}: {
  view: PrivateView | null;
  ownerNames?: OwnerNames;
  markers?: readonly HunterMarker[];
  tick?: number;
  /** S15P21C204-295. 홀수 칸 수를 주면 내 주변만 확대한 창으로 그린다(경기·혼자 연습 화면). */
  windowCells?: number;
  /** 주면 창 모드에서 매 프레임 이 값으로 다시 그려 내 위치가 선형으로 흐른다. */
  renderTick?: () => number | null;
  /** Only the operator demo supplies this; player rooms must leave it absent. */
  operatorExit?: Cell | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ view, markers, tick, renderTick, operatorExit });
  latest.current = { view, markers, tick, renderTick, operatorExit };
  const continuous = windowCells !== undefined && renderTick !== undefined;
  useEffect(
    () => {
      const canvas = ref.current;
      if (!canvas) return;
      const draw = () => {
        const { view, markers, tick, renderTick, operatorExit } = latest.current;
        // S15P21C204-277. 칸이 정수 픽셀에 앉도록 배율도 정수로 고른다.
        const dpr = Math.max(1, Math.min(Math.floor(window.devicePixelRatio || 1), 2));
        const size = canvas.clientWidth || 240;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // 전체 지도는 도트가 살도록, 창 모드는 부채꼴·선이 매끈하도록.
        ctx.imageSmoothingEnabled = windowCells !== undefined;
        drawMinimap(ctx, {
          view,
          size: size * dpr,
          tick: renderTick?.() ?? tick,
          markers,
          operatorExit,
          ...(windowCells === undefined ? {} : { window: windowCells }),
        });
      };
      draw();
      const observer = new ResizeObserver(draw);
      observer.observe(canvas);
      let frame = 0;
      if (continuous && typeof requestAnimationFrame === 'function') {
        const loop = () => {
          draw();
          frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
      }
      return () => {
        observer.disconnect();
        if (frame) cancelAnimationFrame(frame);
      };
      // 연속 모드는 프레임마다 latest 를 읽으므로 뷰·틱이 바뀔 때 다시 구독하지 않는다.
    },
    continuous
      ? [windowCells, continuous]
      : [view, markers, tick, windowCells, continuous, operatorExit],
  );
  return (
    <figure className={windowCells === undefined ? 'mini-map' : 'mini-map mini-map-window'}>
      <canvas
        ref={ref}
        aria-label={
          windowCells === undefined
            ? `내가 탐색한 지도. 위쪽은 북쪽입니다. 채운 칸은 가 본 바닥, 두꺼운 띠는 벽, 옅은 격자는 아직 안 가 본 곳입니다.${operatorExit ? ' O 표시는 운영자 출구입니다.' : ''}`
            : `내 주변 ${windowCells}칸 지도. 가운데 흰 점이 나, 점에서 퍼지는 부채꼴이 내가 보는 방향이고 위쪽이 북쪽입니다.`
        }
      />
      <figcaption>
        {windowCells === undefined
          ? '탐색 지도 · 북쪽 고정 · 옅은 격자는 안 가 본 곳'
          : '내 주변 · 흰 점 = 나 · 부채꼴 = 시선 · N = 북쪽'}
        {operatorExit && <span className="mini-map-operator-exit"> · ◇ 운영자 출구</span>}
      </figcaption>
      {pastEventMarkers(view, markers, tick).length > 0 && <p>빈 원은 과거 사건 위치입니다.</p>}
      {operatorExit && <p aria-label="운영자 출구">O 운영자 출구</p>}
      {mapDrawModel(view, tick)?.exits.map((exit, index) => (
        <div key={exit.exitId}>
          {index + 1}.{' '}
          {exitOwnerLabel(
            exit.ownerId,
            view?.spectating?.targetId ?? view?.self?.playerId,
            ownerNames,
          )}
        </div>
      ))}
    </figure>
  );
}
