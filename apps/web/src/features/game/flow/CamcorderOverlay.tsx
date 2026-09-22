import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Role } from '@kkakkung/protocol/game-schema';
import { TaggerVeins } from './TaggerVeins';

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

/**
 * 화면 테두리는 역할이 정한다. 도망자는 캠코더를 들고 다니므로 REC 와 모서리 표식을 보고,
 * 술래는 장비만 들고 다니므로 가장자리에 핏줄이 번진다(S15P21C204-295).
 * 역할을 모르는 화면(관전·검수)은 캠코더를 쓴다.
 */
/**
 * 무대 맨 위의 시계. 남은 시간이 있으면 내려가는 시간을, 없으면(연습) 지나간 시간을 보여 준다.
 * 캠코더를 쓰지 않는 술래도 시간을 봐야 하므로 테두리와 따로 둔다(S15P21C204-295).
 */
export function StageClock({
  remainingSeconds,
  elapsedFrom,
  nowMs,
}: {
  remainingSeconds?: number | null;
  elapsedFrom?: number;
  nowMs?: number;
}) {
  const mountedAtMs = useRef(elapsedFrom ?? Date.now());
  const [clockMs, setClockMs] = useState(() => Date.now());
  // S15P21C204-342. null 은 "제한시간이 없다"(데모 라운드)는 뜻이다. undefined 와 똑같이 지난
  // 시간을 흘린다. 전에는 초를 세지 않아 00:00:00 에 멈춘 채 "남은 시간" 으로 읽혔다.
  const counting = remainingSeconds === undefined || remainingSeconds === null;
  useEffect(() => {
    if (nowMs !== undefined || !counting) return;
    const interval = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [nowMs, counting]);
  const text = counting
    ? formatRecordingTime(((nowMs ?? clockMs) - (elapsedFrom ?? mountedAtMs.current)) / 1_000)
    : `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(
        remainingSeconds % 60,
      ).padStart(2, '0')}`;
  const low = typeof remainingSeconds === 'number' && remainingSeconds <= 30;
  return (
    <p
      className="stage-clock"
      role="status"
      aria-label={counting ? `지난 시간 ${text}` : `남은 시간 ${text}`}
      data-low={low}
    >
      {text}
    </p>
  );
}

export function GameStatusChrome({
  status,
  role,
  remainingSeconds,
  startedAtMs,
  nowMs,
}: {
  status: ReactNode;
  role?: Role | null;
  remainingSeconds?: number | null;
  startedAtMs?: number;
  nowMs?: number;
}) {
  return (
    <>
      {remainingSeconds !== undefined && (
        <StageClock
          remainingSeconds={remainingSeconds}
          {...(nowMs === undefined ? {} : { nowMs })}
        />
      )}
      {role === 'tagger' ? (
        <TaggerVeins />
      ) : (
        <CamcorderOverlay
          {...(startedAtMs === undefined ? {} : { startedAtMs })}
          {...(nowMs === undefined ? {} : { nowMs })}
        />
      )}
      <div className="game-status-a11y">{status}</div>
    </>
  );
}
