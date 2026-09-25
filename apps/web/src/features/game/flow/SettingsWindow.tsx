// S15P21C204-295. 설정 창 하나를 홈과 게임 안(Esc)이 함께 쓴다. 같은 갈래, 같은 줄, 같은 저장소다.
// 지금 쓸 수 없는 갈래는 숨기지 않고 이유를 적어 잠근다: 홈에서는 카메라를 켤 세션이 없다.
// 창틀·목록·발치 규칙은 docs/design/ui-system.md 의 "창(일시 정지)" 항목이다.
import { useState, type ReactNode } from 'react';

export type SettingsTab = Readonly<{
  id: string;
  label: string;
  /** 갈래가 아니라 바로 가는 항목. 누르면 내용을 바꾸지 않고 이 일을 한다(튜토리얼). */
  run?: () => void;
  /** 지금 쓸 수 없는 갈래의 이유. 있으면 목록에서 눌리지 않고 내용 대신 이 문장이 보인다. */
  locked?: string;
  content: ReactNode;
}>;

export type SettingsAction = Readonly<{
  label: string;
  disabled?: boolean;
  danger?: boolean;
  run(): void;
}>;

export function SettingsWindow({
  variant,
  eyebrow,
  title,
  subtitle,
  tabs,
  initialTab,
  lead,
  tail,
  footer,
  alert,
}: {
  /** overlay 는 무대를 덮는 일시 정지 창, inline 은 홈 화면에 놓인 같은 창이다. */
  variant: 'overlay' | 'inline';
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  tabs: readonly SettingsTab[];
  initialTab?: string;
  /** 목록 맨 위(계속하기·돌아가기). */
  lead?: SettingsAction;
  /** 목록 맨 아래, 선 아래로 떨어진 자리(체험 마치기). */
  tail?: SettingsAction;
  footer?: ReactNode;
  alert?: ReactNode;
}) {
  const first = tabs.find((tab) => !tab.locked && !tab.run) ?? tabs[0]!;
  const [active, setActive] = useState(initialTab ?? first.id);
  const current = tabs.find((tab) => tab.id === active) ?? first;
  return (
    <div className="settings-window" data-variant={variant}>
      <header className="pause-head">
        <p className="pause-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {alert}
      <div className="pause-body">
        <nav className="pause-tabs" aria-label="설정 갈래">
          {lead && (
            <button
              type="button"
              className="pause-resume"
              disabled={lead.disabled ?? false}
              onClick={lead.run}
            >
              {lead.label}
            </button>
          )}
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={tab.run ? undefined : tab.id === current.id}
              disabled={Boolean(tab.locked)}
              title={tab.locked ?? undefined}
              onClick={() => (tab.run ? tab.run() : setActive(tab.id))}
            >
              {tab.label}
            </button>
          ))}
          {tail && (
            <button
              type="button"
              className="pause-quit"
              data-danger={tail.danger ?? false}
              disabled={tail.disabled ?? false}
              onClick={tail.run}
            >
              {tail.label}
            </button>
          )}
        </nav>
        <div className="pause-pane">
          {current.locked ? <p className="pause-note">{current.locked}</p> : current.content}
        </div>
      </div>
      {footer && <footer className="pause-foot">{footer}</footer>}
    </div>
  );
}
