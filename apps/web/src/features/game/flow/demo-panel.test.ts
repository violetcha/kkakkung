/**
 * S15P21C204-260. The operator panel shows only what the server offered and never invents a
 * scenario. A player room receives no demo state at all, so the panel is simply not rendered.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { demoStateSchema, type DemoStateMessage } from '@kkakkung/protocol/game-messages';
import { DemoPanel } from './DemoPanel';

const state = (over: Partial<DemoStateMessage> = {}): DemoStateMessage =>
  demoStateSchema.parse({
    matchId: 'match-1',
    available: ['trap', 'capture', 'result-runner-win'],
    running: null,
    step: null,
    failure: null,
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
  expect(running).toContain('진행 중: 술래가 나를 포획 · chase-operator');
  expect(running.match(/disabled/g)).toHaveLength(3);
  const stopped = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({ failure: 'chase-operator:TIMEOUT' }),
      onRun: () => {},
    }),
  );
  expect(stopped).toContain('직전 시나리오 중단: chase-operator:TIMEOUT');
  expect(stopped).not.toContain('disabled');
});

it('asks for exactly the scenario id the button stands for', () => {
  const onRun = vi.fn();
  // Rendering to markup cannot click, so the handler contract is checked directly.
  const element = createElement(DemoPanel, { demo: state(), onRun });
  const props = element.props as { demo: DemoStateMessage; onRun: (id: string) => void };
  props.onRun(props.demo.available[0]!);
  expect(onRun).toHaveBeenCalledWith('trap');
  expect(onRun).toHaveBeenCalledTimes(1);
});
