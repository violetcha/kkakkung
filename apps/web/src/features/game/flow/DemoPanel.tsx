import { useState } from 'react';
import type { DemoScenarioId, DemoStateMessage } from '@kkakkung/protocol/game-messages';
import {
  demoFailureDetail,
  demoFailureLabel,
  demoScenarioGuide,
  demoStepLabel,
} from './demo-scenario-guide';

type DemoOptionValues = Readonly<{
  role?: 'tagger' | 'runner';
  distance?: 1 | 2 | 3 | 4 | 5;
  side?: 'front' | 'left' | 'right' | 'back';
  facing?: 'toward' | 'away';
  installer?: 'puppet' | 'me';
}>;

type AvailableScenario =
  | DemoScenarioId
  | {
      id: DemoScenarioId;
      options?: readonly (keyof DemoOptionValues)[];
      /** 지금 시작할 수 없는 이유. 있으면 버튼은 잠긴 채 이유와 함께 남는다(332). */
      unavailable?: string;
    };

const OPTION_LABELS: Readonly<Record<keyof DemoOptionValues, string>> = {
  role: '역할',
  distance: '거리',
  side: '위치',
  facing: '방향',
  installer: '설치자',
};

const OPTION_VALUES: Readonly<Record<keyof DemoOptionValues, readonly string[]>> = {
  role: ['tagger', 'runner'],
  distance: ['1', '2', '3', '4', '5'],
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
  '4': '4칸',
  '5': '5칸',
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
 * S15P21C204-260. Operator-only scenario buttons. The list comes from the server, so this panel
 * never invents a scenario, and a player room never receives the state that shows it.
 */
export function DemoPanel({
  demo,
  onRun,
  onRunWithOptions,
  onAbort,
  onCancel,
  phase,
}: {
  demo: DemoStateMessage;
  onRun(scenario: DemoScenarioId): void;
  onRunWithOptions?(scenario: DemoScenarioId, options: DemoOptionValues): void;
  onAbort?(): void;
  /** S15P21C204-342. 도는 대본만 내린다. 라운드를 끝내는 onAbort 와 다르다. */
  onCancel?(): void;
  phase?: string | null;
}) {
  const [options, setOptions] = useState<Record<string, DemoOptionValues>>({});
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
  const blockedReason = (scenario: AvailableScenario) =>
    typeof scenario === 'string' ? undefined : scenario.unavailable;
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
        <div className="demo-panel-controls">
          {onCancel && (
            // 관리자를 기다리는 대본은 2분을 잡는다. 라운드를 끝내지 않고 그것만 내린다(332).
            <button type="button" className="quiet" disabled={!running} onClick={onCancel}>
              시나리오 취소
            </button>
          )}
          {onAbort && (
            // 대본이 도는 중에도 누를 수 있다. 막힌 라운드를 끝내는 유일한 길이 이 단추다(313).
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
                const blocked = blockedReason(scenario);
                return (
                  <div key={id} className="demo-scenario-item" data-blocked={blocked ?? undefined}>
                    <button
                      type="button"
                      disabled={running || beforeGame || blocked !== undefined}
                      aria-describedby={`demo-guide-${id}`}
                      onClick={() => run(scenario)}
                    >
                      {item.label}
                    </button>
                    {blocked && <p className="demo-blocked">{demoFailureLabel(blocked)}</p>}
                    {fields.length > 0 && (
                      <div className="demo-options" aria-label={`${item.label} 선택 사항`}>
                        {fields.map((field) => (
                          <label key={field}>
                            {OPTION_LABELS[field]}
                            <select
                              value={String(options[id]?.[field] ?? '')}
                              disabled={running || beforeGame || blocked !== undefined}
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
      {/* 결과 번호로 다시 그린다. 같은 이유로 또 거절돼 문구가 같아도 눌린 것이 보인다(332). */}
      <p role="status" key={demo.outcomeSeq} className="demo-outcome">
        {running
          ? `진행 중: ${demoScenarioGuide(demo.running!).label} — ${demoStepLabel(demo.step)}`
          : demo.failureCode
            ? `중단: ${demoFailureDetail(demo.failureCode)}`
            : demo.completed
              ? `완료: ${demoScenarioGuide(demo.completed).label}`
              : '시나리오를 고르면 인형이 실제 규칙으로 움직입니다.'}
      </p>
    </section>
  );
}
