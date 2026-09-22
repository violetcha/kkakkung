// S15P21C204-313. 서버 대본이 내보내는 코드·단계마다 웹에 한국어 라벨이 있는지.
//
// 전에는 라벨 시험이 웹 자신의 목록만 돌아 늘 통과했고, 서버 코드 10개와 단계 48개가 "진행 중"·
// "완료하지 못했습니다" 같은 일반 문구로 나갔다. 여기서는 서버 원본을 기준으로 본다.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEMO_FAILURE_REASONS, DEMO_REJECTIONS } from '../../server/src/rooms/DemoScenarios.js';
import {
  demoFailureCodes,
  demoStepLabel,
  demoStepLabelKeys,
} from '../../apps/web/src/features/game/flow/demo-scenario-guide.js';

const source = readFileSync(
  new URL('../../server/src/rooms/DemoScenarios.ts', import.meta.url),
  'utf8',
);

it('labels every refusal and stop reason the scenarios can report', () => {
  const labelled = new Set(demoFailureCodes());
  const missing = [...DEMO_REJECTIONS, ...DEMO_FAILURE_REASONS].filter(
    (code) => !labelled.has(code),
  );
  expect(missing).toEqual([]);
});

it('labels every step the scenarios can be on', () => {
  const fixed = [
    ...source.matchAll(/label: '([a-z-]+)'/g),
    // 단계 이름을 헬퍼 인자로 넘기는 곳(awaitSession). label: 만 훑다가 offer-pending 을 놓쳤다.
    ...source.matchAll(/awaitSession\([^,]+, '([a-z-]+)'\)/g),
  ].map((match) => match[1]!);
  // 인형·장비마다 식별자가 붙는 단계는 접두어로 본다.
  const templated = [...source.matchAll(/label: `([a-z-]+)\$\{/g)].map((match) => match[1]!);
  expect(fixed.length + templated.length).toBeGreaterThan(40);
  for (const step of fixed) expect(demoStepLabel(step), step).not.toBe('진행 중');
  for (const prefix of templated) {
    expect(demoStepLabel(`${prefix}0b7c1f9e-puppet`), prefix).not.toBe('진행 중');
    expect(demoStepLabelKeys()).toContain(prefix);
  }
});
