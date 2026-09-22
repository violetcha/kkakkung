import { useEffect, useRef, useState } from 'react';
import type { DemoScenarioId, DemoStateMessage } from '@kkakkung/protocol/game-messages';
import { demoFailureLabel, demoScenarioGuide, demoStepLabel } from './demo-scenario-guide';

type DemoOptionValues = Readonly<{
  role?: 'tagger' | 'runner';
  distance?: 1 | 2 | 3;
  side?: 'front' | 'left' | 'right' | 'back';
  facing?: 'toward' | 'away';
  installer?: 'puppet' | 'me';
}>;

type AvailableScenario =
  DemoScenarioId | { id: DemoScenarioId; options?: readonly (keyof DemoOptionValues)[] };

const OPTION_LABELS: Readonly<Record<keyof DemoOptionValues, string>> = {
  role: '역할',
  distance: '거리',
  side: '위치',
  facing: '방향',
  installer: '설치자',
};

const OPTION_VALUES: Readonly<Record<keyof DemoOptionValues, readonly string[]>> = {
  role: ['tagger', 'runner'],
  distance: ['1', '2', '3'],
  side: ['front', 'left', 'right', 'back'],
  facing: ['toward', 'away'],
  installer: ['puppet', 'me'],
};

const OPTION_VALUE_LABELS: Readonly<Record<string, string>> = {
  tagger: '술래',
  runner: '도망자',
  '1': '1칸',
  '2': '2칸',
  '3': '3칸',
  front: '앞',
  left: '왼쪽',
  right: '오른쪽',
  back: '뒤',
  toward: '나를 봄',
  away: '등짐',
  puppet: '인형',
  me: '나',
};

/**
 * S15P21C204-313. 방금 끝난 시나리오가 성공했는지. 서버는 성공을 따로 알리지 않고 `running` 을
 * 비우기만 하므로, 도는 중이던 것이 실패 없이 사라지면 완료로 본다. 다음 실행·실패에서 지운다.
 */
export function completedScenario(
  previousRunning: string | null,
  demo: Pick<DemoStateMessage, 'running' | 'failureCode'>,
  current: string | null,
): string | null {
  if (demo.running !== null || demo.failureCode !== null) return null;
  return previousRunning ?? current;
}

/**
 * S15P21C204-260. Operator-only scenario buttons. The list comes from the server, so this panel
 * never invents a scenario, and a player room never receives the state that shows it.
 */
export function DemoPanel({
  demo,
  onRun,
  onRunWithOptions,
  onAbort,
  phase,
}: {
  demo: DemoStateMessage;
  onRun(scenario: DemoScenarioId): void;
  onRunWithOptions?(scenario: DemoScenarioId, options: DemoOptionValues): void;
  onAbort?(): void;
  phase?: string | null;
}) {
  const [options, setOptions] = useState<Record<string, DemoOptionValues>>({});
  const [completed, setCompleted] = useState<string | null>(null);
  const previousRunning = useRef<string | null>(demo.running);
  useEffect(() => {
    setCompleted((current) => completedScenario(previousRunning.current, demo, current));
    previousRunning.current = demo.running;
  }, [demo]);
  const running = demo.running !== null;
  const beforeGame = phase != null && !['PLAYING', 'RESULT'].includes(phase);
  const available = demo.available as readonly AvailableScenario[];
  const groups = new Map<string, AvailableScenario[]>();
  for (const scenario of available) {
    const id = typeof scenario === 'string' ? scenario : scenario.id;
    const key = demoScenarioGuide(id).group;
    const group = groups.get(key) ?? [];
    group.push(scenario);
    groups.set(key, group);
  }
  const setOption = (id: string, key: keyof DemoOptionValues, value: string) => {
    setOptions((current) => ({
      ...current,
      [id]: { ...current[id], [key]: key === 'distance' ? Number(value) : value },
    }));
  };
  const run = (scenario: AvailableScenario) => {
    const id = typeof scenario === 'string' ? scenario : scenario.id;
    const selected = options[id] ?? {};
    if (onRunWithOptions && Object.keys(selected).length > 0) onRunWithOptions(id, selected);
    else onRun(id);
  };
  return (
    <section className="game-panel demo-panel" aria-label="데모 시나리오">
      <div className="demo-panel-heading">
        <div>
          <p className="eyebrow">OPERATOR CONSOLE</p>
          <h2>데모 시나리오</h2>
        </div>
        {onAbort && (
          // 대본이 도는 중에도 누를 수 있다. 막힌 대본을 끝내는 유일한 길이 이 단추다(313).
          <button
            type="button"
            className="demo-abort"
            disabled={beforeGame || phase === 'RESULT'}
            onClick={onAbort}
          >
            라운드 종료
          </button>
        )}
      </div>
      {beforeGame && (
        <p className="demo-panel-note">경기가 시작되면 시나리오를 실행할 수 있습니다.</p>
      )}
      <div className="demo-scenario-groups">
        {[...groups.entries()].map(([group, scenarios]) => (
          <section
            key={group}
            className="demo-scenario-group"
            aria-labelledby={`demo-group-${group}`}
          >
            <h3 id={`demo-group-${group}`}>
              {
                demoScenarioGuide(
                  scenarios[0] === undefined
                    ? ''
                    : typeof scenarios[0] === 'string'
                      ? scenarios[0]
                      : scenarios[0].id,
                ).groupLabel
              }
            </h3>
            <div className="actions">
              {scenarios.map((scenario) => {
                const id = typeof scenario === 'string' ? scenario : scenario.id;
                const item = demoScenarioGuide(id);
                const fields =
                  typeof scenario === 'string' ? [] : (scenario.options ?? item.options ?? []);
                return (
                  <div key={id} className="demo-scenario-item">
                    <button
                      type="button"
                      disabled={running || beforeGame}
                      aria-describedby={`demo-guide-${id}`}
                      onClick={() => run(scenario)}
                    >
                      {item.label}
                    </button>
                    {fields.length > 0 && (
                      <div className="demo-options" aria-label={`${item.label} 선택 사항`}>
                        {fields.map((field) => (
                          <label key={field}>
                            {OPTION_LABELS[field]}
                            <select
                              value={String(options[id]?.[field] ?? '')}
                              disabled={running || beforeGame}
                              onChange={(event) => setOption(id, field, event.target.value)}
                            >
                              <option value="">기본값</option>
                              {OPTION_VALUES[field].map((value) => (
                                <option key={value} value={value}>
                                  {OPTION_VALUE_LABELS[value] ?? value}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    )}
                    <details id={`demo-guide-${id}`} className="demo-checklist">
                      <summary>{item.description}</summary>
                      <ul>
                        {item.checklist.map((check) => (
                          <li key={check}>{check}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <p role="status">
        {running
          ? `진행 중: ${demoScenarioGuide(demo.running!).label} · ${demoStepLabel(demo.step)}`
          : demo.failureCode
            ? `직전 시나리오 중단: ${demoFailureLabel(demo.failureCode)}`
            : completed
              ? `완료: ${demoScenarioGuide(completed).label}`
              : '시나리오를 고르면 인형이 실제 규칙으로 움직입니다.'}
      </p>
    </section>
  );
}
