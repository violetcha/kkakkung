import type { DemoScenarioId, DemoStateMessage } from '@kkakkung/protocol/game-messages';

/** Operator wording for each scenario the server offers. Unknown ids fall back to their id. */
const LABELS: Readonly<Record<DemoScenarioId, string>> = {
  trap: '덫 설치·무장',
  sensor: '감지기 설치',
  capture: '술래가 나를 포획',
  'capture-one': '인형끼리 포획 · 누계 +1',
  approach: '상대가 다가오기',
  exit: '인형 도망자 탈출 · 누계 +1',
  exchange: '지도 교환 요청',
  'exchange-cancel': '지도 교환 요청 뒤 취소',
  'exchange-trace': '지도 교환 흔적 · 술래 시점',
  'result-tagger-win': '결과 화면 · 술래 승리',
  'result-runner-win': '결과 화면 · 도망자 승리',
  'abort-connection-lost': '연결 상실 무효',
};

/**
 * S15P21C204-260. Operator-only scenario buttons. The list comes from the server, so this panel
 * never invents a scenario, and a player room never receives the state that shows it.
 */
export function DemoPanel({
  demo,
  onRun,
}: {
  demo: DemoStateMessage;
  onRun(scenario: DemoScenarioId): void;
}) {
  const running = demo.running !== null;
  return (
    <section className="game-panel demo-panel" aria-label="데모 시나리오">
      <h2>데모 시나리오</h2>
      <div className="actions">
        {demo.available.map((scenario) => (
          <button key={scenario} disabled={running} onClick={() => onRun(scenario)}>
            {LABELS[scenario] ?? scenario}
          </button>
        ))}
      </div>
      <p role="status">
        {running
          ? `진행 중: ${LABELS[demo.running!] ?? demo.running} · ${demo.step ?? '준비'}`
          : demo.failure
            ? `직전 시나리오 중단: ${demo.failure}`
            : '시나리오를 고르면 인형이 실제 규칙으로 움직입니다.'}
      </p>
    </section>
  );
}
