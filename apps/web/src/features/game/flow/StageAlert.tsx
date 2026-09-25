// S15P21C204-386. 술래 화면 위쪽의 장비 발동 알림. 사건 로그는 화면 낭독기 전용이라 눈에 보이지
// 않고, 전면 플래시는 0.9초라 방향까지 읽기엔 짧다. 이 띠가 "▲ 덫 작동 · 북동쪽"을 몇 초 남긴다.
import { useEffect, useState } from 'react';

export type StageAlertValue = Readonly<{ id: number; kind: 'trap' | 'sensor'; text: string }>;

/** 띠가 떠 있는 시간. 미니맵 표식(2초)보다 조금 길게 남아 방향을 읽을 틈을 준다. */
export const STAGE_ALERT_MS = 3000;

export function StageAlert({ alert }: { alert: StageAlertValue | null | undefined }) {
  const [shownId, setShownId] = useState<number | null>(null);
  useEffect(() => {
    if (!alert) return;
    setShownId(alert.id);
    const timer = window.setTimeout(
      () => setShownId((id) => (id === alert.id ? null : id)),
      STAGE_ALERT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [alert]);
  if (!alert || shownId !== alert.id) return null;
  return (
    <p key={alert.id} className="stage-alert" data-kind={alert.kind} role="status">
      {alert.text}
    </p>
  );
}
