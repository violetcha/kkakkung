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
  operatorExit = null,
}: {
  view: PrivateView | null;
  ownerNames?: OwnerNames;
  markers?: readonly HunterMarker[];
  tick?: number;
  /** Only the operator demo supplies this; player rooms must leave it absent. */
  operatorExit?: Cell | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      // S15P21C204-277. 칸이 정수 픽셀에 앉도록 배율도 정수로 고른다.
      const dpr = Math.max(1, Math.min(Math.floor(window.devicePixelRatio || 1), 2));
      const size = canvas.clientWidth || 240;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      drawMinimap(ctx, { view, size: size * dpr, tick, markers, operatorExit });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [view, markers, tick, operatorExit]);
  return (
    <figure className="mini-map">
      <canvas
        ref={ref}
        aria-label={`내가 탐색한 지도. 위쪽은 북쪽입니다. 채운 칸은 가 본 바닥, 두꺼운 띠는 벽, 옅은 격자는 아직 안 가 본 곳입니다.${operatorExit ? ' O 표시는 운영자 출구입니다.' : ''}`}
      />
      <figcaption>
        탐색 지도 · 북쪽 고정 · 옅은 격자는 안 가 본 곳
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
