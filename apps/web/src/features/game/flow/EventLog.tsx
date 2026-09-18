import { useEffect, useState } from 'react';
import { EVENT_TTL_MS, visibleEvents, type MatchEvent } from './event-log';

/**
 * S15P21C204-276. 좌하단 사건 로그. 최근 몇 줄만 보여 주고 스스로 사라진다.
 * 사라질 때가 되면 다시 그려야 하므로 짧은 주기로 시계만 읽는다.
 */
export function EventLog({
  events,
  now = () => Date.now(),
}: {
  events: readonly MatchEvent[];
  now?(): number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (events.length === 0) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [events]);
  const shown = visibleEvents(events, now());
  if (shown.length === 0) return null;
  return (
    <ul className="event-log" aria-label="사건 기록" aria-live="polite">
      {shown.map((event) => (
        <li key={event.id} style={{ opacity: 1 - (now() - event.atMs) / EVENT_TTL_MS / 2 }}>
          {event.text}
        </li>
      ))}
    </ul>
  );
}
