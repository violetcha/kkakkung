import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

export type FrameMetrics = {
  fps: number;
  p95Ms: number;
  draws: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
};

export function shouldReportFrameMetrics(elapsedMs: number, sampleCount: number) {
  return elapsedMs >= 1000 && sampleCount >= 2;
}

/** Opt-in inspection, never a substitute for six real devices with vision and media. */
export function FrameMetricsProbe({ report }: { report(metrics: FrameMetrics): void }) {
  const samples = useRef<number[]>([]);
  const lastReport = useRef(0);
  useFrame(({ gl }, delta) => {
    const now = performance.now();
    if (document.hidden) {
      samples.current = [];
      lastReport.current = now;
      return;
    }
    if (!Number.isFinite(delta) || delta <= 0) return;
    samples.current.push(delta * 1000);
    if (samples.current.length > 300) samples.current.shift();
    if (!shouldReportFrameMetrics(now - lastReport.current, samples.current.length)) return;
    const sorted = [...samples.current].sort((a, b) => a - b);
    report({
      fps: (1000 * sorted.length) / sorted.reduce((sum, sample) => sum + sample, 0),
      p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!,
      draws: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
    });
    samples.current = [];
    lastReport.current = now;
  });
  return null;
}
