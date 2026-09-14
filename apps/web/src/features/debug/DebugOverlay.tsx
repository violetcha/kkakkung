// 카메라 미리보기 위에 추적 결과를 겹쳐 그리는 캔버스. 켜져 있을 때만 마운트한다.
// 판정에 영향을 주지 않으며(pointer-events 없음, 피드 읽기만) 제거해도 제품 경로는 그대로다.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { debugFeed } from './debug-feed';
import { drawDebugOverlay, readoutLines } from './draw-debug';

/** object-fit: contain 인 video 안에서 실제 프레임이 차지하는 사각형(host 기준 좌표). */
export function frameRect(
  host: DOMRect,
  video: DOMRect,
  frame: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  if (frame.width <= 0 || frame.height <= 0 || video.width <= 0 || video.height <= 0)
    return {
      left: video.left - host.left,
      top: video.top - host.top,
      width: video.width,
      height: video.height,
    };
  const scale = Math.min(video.width / frame.width, video.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    left: video.left - host.left + (video.width - width) / 2,
    top: video.top - host.top + (video.height - height) / 2,
    width,
    height,
  };
}

export function DebugOverlay({ host }: { host: HTMLElement | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [readout, setReadout] = useState('');
  useEffect(() => {
    const timer = window.setInterval(
      () => setReadout(readoutLines(debugFeed.read(), performance.now()).join('\n')),
      100,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!host) return;
    let raf = 0;
    const loop = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const video = host.querySelector('video');
        const hostRect = host.getBoundingClientRect();
        const rect = video
          ? frameRect(hostRect, video.getBoundingClientRect(), {
              width: video.videoWidth,
              height: video.videoHeight,
            })
          : { left: 0, top: 0, width: hostRect.width, height: hostRect.height };
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.style.left = `${Math.round(rect.left)}px`;
        canvas.style.top = `${Math.round(rect.top)}px`;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        // 미리보기 video 는 styles.css 에서 거울처럼(scaleX(-1)) 보이므로 점도 같이 뒤집는다.
        if (ctx) drawDebugOverlay(ctx, width, height, debugFeed.read(), { mirrored: true });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [host]);
  return (
    <>
      {host &&
        createPortal(
          <canvas
            ref={canvasRef}
            className="debug-overlay"
            aria-hidden="true"
            data-testid="debug-overlay"
          />,
          host,
        )}
      <pre className="debug-readout" aria-label="추적 디버그 수치">
        {readout}
      </pre>
    </>
  );
}
