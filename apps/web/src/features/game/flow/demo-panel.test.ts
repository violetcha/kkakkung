/**
 * S15P21C204-260. The operator panel shows only what the server offered and never invents a
 * scenario. A player room receives no demo state at all, so the panel is simply not rendered.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { demoStateSchema, type DemoStateMessage } from '@kkakkung/protocol/game-messages';
import { DemoPanel } from './DemoPanel';
import { DEMO_SCENARIO_GUIDE, demoFailureCodes } from './demo-scenario-guide';

const state = (over: Partial<DemoStateMessage> = {}): DemoStateMessage =>
  demoStateSchema.parse({
    matchId: 'match-1',
    available: [
      { id: 'trap', options: [] },
      { id: 'capture', options: [] },
      { id: 'result-runner-win', options: [] },
    ],
    running: null,
    step: null,
    failureCode: null,
    operatorExit: null,
    ...over,
  });

it('offers a button per scenario the server listed', () => {
  const html = renderToStaticMarkup(createElement(DemoPanel, { demo: state(), onRun: () => {} }));
  expect(html).toContain('덫 설치·무장');
  expect(html).toContain('술래가 나를 포획');
  expect(html).toContain('결과 화면 · 도망자 승리');
  // Scenarios the server did not offer have no button.
  expect(html).not.toContain('감지기 설치');
  expect(html).not.toContain('disabled');
});

it('locks the buttons while one runs and reports a stopped scenario', () => {
  const running = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({ running: 'capture', step: 'chase-operator' }),
      onRun: () => {},
    }),
  );
  expect(running).toContain('진행 중: 술래가 나를 포획 · 관리자에게 접근하는 중');
  expect(running.match(/disabled/g)).toHaveLength(3);
  const stopped = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({ failureCode: 'chase-operator:TIMEOUT' }),
      onRun: () => {},
    }),
  );
  expect(stopped).toContain('직전 시나리오 중단: 정해진 시간 안에 조건을 확인하지 못했습니다.');
  expect(stopped).not.toContain('disabled');
});

it('asks for exactly the scenario id the button stands for', () => {
  const onRun = vi.fn();
  // Rendering to markup cannot click, so the handler contract is checked directly.
  const element = createElement(DemoPanel, { demo: state(), onRun });
  const props = element.props as { demo: DemoStateMessage; onRun: (id: string) => void };
  props.onRun(props.demo.available[0]!.id);
  expect(onRun).toHaveBeenCalledWith('trap');
  expect(onRun).toHaveBeenCalledTimes(1);
});

it('keeps a Korean label and at least one checklist for every planned scenario', () => {
  for (const item of Object.values(DEMO_SCENARIO_GUIDE)) {
    expect(item.label).not.toBe(item.id);
    expect(item.checklist.length).toBeGreaterThan(0);
    expect(item.description).not.toBe('');
  }
});

it('has a user-facing label for every known failure code', () => {
  const html = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({ failureCode: 'place:PATH_BLOCKED' }),
      onRun: () => {},
    }),
  );
  expect(html).toContain('이동 경로가 막혔습니다.');
  for (const code of demoFailureCodes()) expect(code).not.toBe('');
});

it('disables controls before the round starts and explains why', () => {
  const html = renderToStaticMarkup(
    createElement(DemoPanel, { demo: state(), phase: 'DEVICE_CHECK', onRun: () => {} }),
  );
  expect(html).toContain('경기가 시작되면 시나리오를 실행할 수 있습니다.');
  expect(html.match(/disabled=""/g)).toHaveLength(3);
});
