// S15P21C204-295. 내 캐릭터 창 아래의 앞뒤·좌우 게이지. 진단 피드(debugFeed)의 모션 상태를 그린다.
// 판정에 영향을 주지 않고 피드가 비어 있으면 빈 게이지만 보인다.
import { useEffect, useRef } from 'react';
import { debugFeed } from '../../debug/debug-feed';
import { drawGauges } from '../../debug/draw-debug';

export function MotionGauges() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof requestAnimationFrame !== 'function') return;
    let frame = 0;
    const loop = () => {
      const width = Math.max(1, Math.round(canvas.clientWidth || 240));
      const height = Math.max(1, Math.round(canvas.clientHeight || 44));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        drawGauges(ctx, debugFeed.read(), width, height);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={ref} className="motion-gauges" aria-hidden="true" />;
}
