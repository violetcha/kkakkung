import { useEffect, useRef, useState, type ReactNode } from 'react';

export function formatRecordingTime(elapsedSeconds: number): string {
  const total = Math.max(0, Math.floor(elapsedSeconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function CamcorderOverlay({ startedAtMs, nowMs }: { startedAtMs?: number; nowMs?: number }) {
  const mountedAtMs = useRef(startedAtMs ?? Date.now());
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => {
    if (nowMs !== undefined) return;
    const interval = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [nowMs]);
  const readout = formatRecordingTime(
    ((nowMs ?? clockMs) - (startedAtMs ?? mountedAtMs.current)) / 1_000,
  );

  return (
    <div className="camcorder-overlay" aria-label={`녹화 중 ${readout}`}>
      <div className="camcorder-status" aria-hidden="true">
        <span className="camcorder-rec-dot" />
        <span>REC</span>
        <time>{readout}</time>
      </div>
      <span className="camcorder-corner" data-corner="top-left" aria-hidden="true" />
      <span className="camcorder-corner" data-corner="top-right" aria-hidden="true" />
      <span className="camcorder-corner" data-corner="bottom-left" aria-hidden="true" />
      <span className="camcorder-corner" data-corner="bottom-right" aria-hidden="true" />
    </div>
  );
}

export function GameStatusChrome({
  status,
  startedAtMs,
  nowMs,
}: {
  status: ReactNode;
  startedAtMs?: number;
  nowMs?: number;
}) {
  return (
    <>
      <CamcorderOverlay
        {...(startedAtMs === undefined ? {} : { startedAtMs })}
        {...(nowMs === undefined ? {} : { nowMs })}
      />
      <div className="game-status-a11y">{status}</div>
    </>
  );
}
