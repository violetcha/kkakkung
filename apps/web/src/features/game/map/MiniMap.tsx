import { useEffect, useRef } from 'react';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { mapDrawModel } from './map-draw-model';
import { pastEventMarkers, type HunterMarker } from './past-event-markers';
import { exitOwnerLabel, type OwnerNames } from '../scene/ExitOwnerLabel';
export function MiniMap({
  view,
  ownerNames = {},
  markers = [],
  tick = 0,
}: {
  view: PrivateView | null;
  ownerNames?: OwnerNames;
  markers?: readonly HunterMarker[];
  tick?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas.clientWidth || 240;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#181817';
      ctx.fillRect(0, 0, size, size);
      const model = mapDrawModel(view);
      if (!model) return;
      const unit = size / 32;
      ctx.lineWidth = Math.max(1, unit * 0.18);
      for (const t of model.terrain) {
        const x = (t.x + 0.5) * unit;
        const y = (t.y + 0.5) * unit;
        if (t.kind === 'floor') {
          ctx.fillStyle = '#aaa9a2';
          ctx.fillRect(t.x * unit, t.y * unit, unit, unit);
        } else {
          const s = t.side;
          ctx.strokeStyle = '#fafaf3';
          ctx.beginPath();
          if (s === 0 || s === 2) {
            const offset = s === 0 ? -unit / 2 : unit / 2;
            ctx.moveTo(x - unit / 2, y + offset);
            ctx.lineTo(x + unit / 2, y + offset);
          } else {
            const offset = s === 1 ? unit / 2 : -unit / 2;
            ctx.moveTo(x + offset, y - unit / 2);
            ctx.lineTo(x + offset, y + unit / 2);
          }
          ctx.stroke();
        }
      }
      for (const [index, exit] of model.exits.entries()) {
        ctx.strokeStyle = exit.ownerId === view?.self?.playerId ? '#b8ebca' : '#dfbb79';
        ctx.strokeRect(exit.approach.x * unit, exit.approach.y * unit, unit, unit);
        ctx.fillStyle = '#fafaf3';
        ctx.font = '11px sans-serif';
        ctx.fillText(String(index + 1), (exit.approach.x + 1) * unit, exit.approach.y * unit);
      }
      ctx.save();
      ctx.translate((model.self.cell.x + 0.5) * unit, (model.self.cell.y + 0.5) * unit);
      ctx.rotate((model.self.dir * Math.PI) / 2);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -unit / 2);
      ctx.lineTo(-unit / 3, unit / 3);
      ctx.lineTo(unit / 3, unit / 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      for (const marker of pastEventMarkers(view, markers, tick)) {
        ctx.strokeStyle = '#dfbb79';
        ctx.beginPath();
        ctx.arc(
          (marker.point.x + 0.5) * unit,
          (marker.point.y + 0.5) * unit,
          Math.max(2, unit * 0.3),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [view, markers, tick]);
  return (
    <figure className="mini-map">
      <canvas ref={ref} aria-label="내가 탐색한 지도. 위쪽은 북쪽입니다." />
      <figcaption>탐색 지도 · 북쪽 고정</figcaption>
      {pastEventMarkers(view, markers, tick).length > 0 && <p>빈 원은 과거 사건 위치입니다.</p>}
      {mapDrawModel(view)?.exits.map((exit, index) => (
        <div key={exit.exitId}>
          {index + 1}. {exitOwnerLabel(exit.ownerId, view?.self?.playerId, ownerNames)}
        </div>
      ))}
    </figure>
  );
}
