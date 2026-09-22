/**
 * S15P21C204-260. The operator panel shows only what the server offered and never invents a
 * scenario. A player room receives no demo state at all, so the panel is simply not rendered.
 */
import { readFileSync } from 'node:fs';
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
  expect(running).toContain('진행 중: 술래가 나를 포획 — 관리자에게 접근하는 중');
  expect(running.match(/disabled/g)).toHaveLength(3);
  const stopped = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({ failureCode: 'chase-operator:TIMEOUT' }),
      onRun: () => {},
    }),
  );
  // S15P21C204-342. 어느 단계에서 멈췄는지까지 보여 준다.
  expect(stopped).toContain('중단: 관리자에게 접근하는 중 — 정해진 시간 안에 조건을 확인하지');
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

// S15P21C204-342. 시작할 수 없는 대본을 목록에서 빼면 버튼이 조용히 사라진다. 잠근 채 이유를 단다.
it('keeps a scenario it cannot start, disabled and with the reason', () => {
  const html = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({
        available: [
          { id: 'trap', options: [] },
          { id: 'capture', options: [], unavailable: 'NO_TAGGER_PUPPET' },
        ],
      }),
      phase: 'PLAYING',
      onRun: () => {},
    }),
  );
  expect(html).toContain('술래가 나를 포획');
  expect(html).toContain('술래 인형이 없습니다.');
  // 잠긴 것은 그 버튼뿐이다.
  expect(html.match(/disabled=""/g)).toHaveLength(1);
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

// S15P21C204-313. 패널은 라운드 종료와 선택지 전송을 지원했지만 앱이 그 콜백을 넘기지 않아, 단추는
// 보이지 않고 고른 선택지는 기본값으로 바뀌어 나갔다. 패널 시험은 콜백을 직접 넘기므로 이걸 못 봤다.
it('lets the operator end the round even while a scenario is stuck', () => {
  const render = (over: Partial<DemoStateMessage>, phase: string) =>
    renderToStaticMarkup(
      createElement(DemoPanel, { demo: state(over), phase, onRun: () => {}, onAbort: () => {} }),
    );
  const abort = (html: string) => /<button[^>]*class="demo-abort"[^>]*>/.exec(html)?.[0] ?? '';
  expect(abort(render({ running: 'capture', step: 'chase-operator' }, 'PLAYING'))).not.toContain(
    'disabled',
  );
  expect(abort(render({}, 'DEVICE_CHECK'))).toContain('disabled');
  expect(abort(render({}, 'RESULT'))).toContain('disabled');
});

// S15P21C204-342. 관리자를 기다리는 대본은 2분 동안 다른 버튼을 잠근다. 라운드를 끝내지 않고
// 그 대본만 내릴 수 있어야 한다.
it('cancels only while a scenario is running', () => {
  const render = (over: Partial<DemoStateMessage>) =>
    renderToStaticMarkup(
      createElement(DemoPanel, {
        demo: state(over),
        phase: 'PLAYING',
        onRun: () => {},
        onCancel: () => {},
      }),
    );
  const cancel = (html: string) => {
    const at = html.indexOf('시나리오 취소');
    return at < 0 ? '' : html.slice(html.lastIndexOf('<button', at), at);
  };
  expect(cancel(render({ running: 'capture', step: 'chase-operator' }))).not.toContain('disabled');
  expect(cancel(render({}))).toContain('disabled');
});

// S15P21C204-342. 제한시간 없는 라운드는 남은 시간이 null 이고, 그때 시계가 지난 시간을 흘린다.
// 값을 아예 넘기지 않으면 시계가 화면에서 사라진다.
it('hands the stage clock a null deadline in a demo round', () => {
  const app = readFileSync(new URL('../../../app/ProductApp.tsx', import.meta.url), 'utf8');
  const chrome = /<GameStatusChrome[\s\S]*?\/>/.exec(app)?.[0] ?? '';
  expect(chrome).toContain('round.deadlineTick !== null');
  expect(chrome).toMatch(/remainingSeconds=\{[\s\S]*: null\s*\}/);
});

it('is mounted with the options and round-end callbacks the panel offers', () => {
  const app = readFileSync(new URL('../../../app/ProductApp.tsx', import.meta.url), 'utf8');
  const mounts = [...app.matchAll(/<DemoPanel[\s\S]*?\/>/g)].map((match) => match[0]);
  // 준비 단계에는 목록을 두지 않는다. 경기에 들어가서 본다. 패널은 무대 옆 열 하나뿐이다.
  expect(mounts).toHaveLength(1);
  expect(mounts[0]).toContain('onRunWithOptions=');
  expect(mounts[0]).toContain('onAbort=');
  expect(mounts[0]).toContain('onCancel=');
  const stage = app.slice(app.indexOf('<section className="game-stage"'));
  expect(stage.indexOf('<DemoPanel')).toBeGreaterThan(stage.indexOf('</section>'));
  // S15P21C204-314. 서버가 보내고 미니맵이 그릴 줄 아는 관리자 출구를 앱이 넘기지 않았다.
  const minimap = /<MiniMap[\s\S]*?\/>/.exec(app)?.[0] ?? '';
  expect(minimap).toContain('operatorExit={snapshot.demo?.operatorExit');
});

// S15P21C204-342. 완료는 서버가 알려 준다. 웹이 "도는 중이던 것이 사라짐" 으로 추론하던 때는
// 한 틱에 끝나는 배치처럼 진행 중을 본 적 없는 대본이 표시되지 않았다.
it('shows the scenario the server reports as completed', () => {
  const html = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({ completed: 'place-puppet' }),
      phase: 'PLAYING',
      onRun: () => {},
    }),
  );
  expect(html).toContain('완료: 인형 배치');
});

it('keeps a failure visible over a stale completion', () => {
  const html = renderToStaticMarkup(
    createElement(DemoPanel, {
      demo: state({ completed: null, failureCode: 'come-closer:NO_EXCHANGE_PARTNER' }),
      phase: 'PLAYING',
      onRun: () => {},
    }),
  );
  expect(html).toContain('중단: 인형이 옆으로 오는 중 — 이미 지도를 나눈 인형뿐입니다.');
});
