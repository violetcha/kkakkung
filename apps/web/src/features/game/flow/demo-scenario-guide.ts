export type DemoScenarioOption = 'role' | 'distance' | 'side' | 'facing' | 'installer';

export type DemoScenarioGuide = Readonly<{
  id: string;
  group: string;
  groupLabel: string;
  label: string;
  description: string;
  checklist: readonly string[];
  options?: readonly DemoScenarioOption[];
}>;

const guide = (
  id: string,
  group: string,
  groupLabel: string,
  label: string,
  description: string,
  checklist: readonly string[],
  options?: readonly DemoScenarioOption[],
): DemoScenarioGuide => ({
  id,
  group,
  groupLabel,
  label,
  description,
  checklist,
  ...(options ? { options } : {}),
});

/**
 * The guide is deliberately kept next to the operator UI. It is the readable acceptance
 * contract for a button; the server remains the source of truth for which buttons are offered.
 */
export const DEMO_SCENARIO_GUIDE: Readonly<Record<string, DemoScenarioGuide>> = {
  'place-me-at-exit': guide(
    'place-me-at-exit',
    'A',
    '배치',
    '내 출구 앞에 세우기',
    '도망자인 나를 출구 접근 칸으로 옮깁니다.',
    ['출구 문이 보인다', 'E 안내가 시작된다', '탈출 후 누계와 출구 닫힘을 확인한다'],
  ),
  'place-puppet': guide(
    'place-puppet',
    'A',
    '배치',
    '인형 배치',
    '역할·거리·방향을 고른 인형을 내 기준 위치에 세웁니다.',
    ['역할 색과 실루엣이 보인다', '거리별 크기를 확인한다', '미니맵과 시야 마스크를 확인한다'],
    ['role', 'side', 'distance', 'facing'],
  ),
  approach: guide(
    'approach',
    'B',
    '다가오기·시야',
    '상대가 다가오기',
    '선택한 인형이 걸어와 지정 거리에서 나를 봅니다.',
    ['시야 밖에서 들어온다', '이동 보간과 발소리를 확인한다', '지정 거리에서 멈춘다'],
    ['role', 'distance'],
  ),
  'cross-my-view': guide(
    'cross-my-view',
    'B',
    '다가오기·시야',
    '시야 가로지르기',
    '인형이 시야 한쪽 끝에서 반대쪽으로 지나갑니다.',
    ['가장자리에서 깜빡이지 않는다', '안개 페이드가 자연스럽다', '시야를 벗어나면 사라진다'],
    ['role'],
  ),
  'turn-before-me': guide(
    'turn-before-me',
    'B',
    '다가오기·시야',
    '앞에서 한 바퀴 돌기',
    '내 앞의 인형이 네 방향으로 회전합니다.',
    ['회전이 끊기지 않는다', '얼굴이 앞면에 고정된다', '네 방향의 실루엣을 확인한다'],
    ['role', 'distance'],
  ),
  trap: guide(
    'trap',
    'C',
    '술래 장비',
    '덫 설치·무장',
    '인형 또는 내가 덫을 설치하고 발동까지 확인합니다.',
    ['설치 십자선과 핫바 힌트를 확인한다', '무장 대기를 확인한다', '발동 흔적과 소모를 확인한다'],
    ['installer'],
  ),
  sensor: guide(
    'sensor',
    'C',
    '술래 장비',
    '감지기 설치',
    '인형 또는 내가 감지기를 설치하고 유지 상태를 확인합니다.',
    ['설치 가능 여부를 확인한다', '무장 상태를 확인한다', '감지기 유지 표시를 확인한다'],
    ['installer'],
  ),
  'device-states': guide(
    'device-states',
    'C',
    '술래 장비',
    '장비 상태 순서',
    '설치·무장·발동·소모의 전체 순서를 재생합니다.',
    ['설치 전 상태를 확인한다', '무장과 발동을 확인한다', '소모 상태를 확인한다'],
    ['role'],
  ),
  'double-trap-immunity': guide(
    'double-trap-immunity',
    'C',
    '술래 장비',
    '연속 덫과 면역',
    '두 덫을 연속으로 밟아 구속과 면역을 확인합니다.',
    ['첫 칸에서 구속된다', '둘째 칸에서 면역이 보인다', 'HUD에 면역 시간이 보인다'],
  ),
  capture: guide(
    'capture',
    'D',
    '포획·구속',
    '술래가 나를 포획',
    '인형 술래가 다가와 나를 포획합니다.',
    ['포획 판정을 확인한다', '포획 플래시를 확인한다', '관전으로 전환된다'],
  ),
  'capture-one': guide(
    'capture-one',
    'D',
    '포획·구속',
    '인형끼리 포획',
    '인형끼리 한 쌍을 포획하고 누계를 올립니다.',
    ['누계 포획이 1 증가한다', '라운드가 계속된다', '나의 화면이 유지된다'],
  ),
  'capture-in-challenge': guide(
    'capture-in-challenge',
    'D',
    '포획·구속',
    '도전 중 포획',
    '출구 도전 중인 인형 도망자를 술래가 포획합니다.',
    ['도전이 진행 중이다', '도전이 취소된다', '포획 결과를 확인한다'],
  ),
  'caught-in-my-challenge': guide(
    'caught-in-my-challenge',
    'D',
    '포획·구속',
    '내 도전 중 포획',
    '내가 출구 도전 중일 때 인형 술래가 포획합니다.',
    ['도전 중 포획된다', '포획 플래시를 확인한다', '관전으로 전환된다'],
  ),
  exit: guide(
    'exit',
    'E',
    '출구·탈출',
    '인형 도망자 탈출',
    '인형 도망자가 출구로 가서 탈출합니다.',
    ['출구 도전을 확인한다', '누계 탈출이 1 증가한다', '출구가 닫힌다'],
  ),
  exchange: guide(
    'exchange',
    'F',
    '지도 교환',
    '지도 교환 요청',
    '인형 도망자가 옆에 와 교환을 요청합니다.',
    ['요청 UI가 보인다', '수락 후 지식이 확장된다', '방치 시 요청이 만료된다'],
  ),
  'exchange-cancel': guide(
    'exchange-cancel',
    'F',
    '지도 교환',
    '교환 요청 취소',
    '인형이 보낸 교환 요청을 취소합니다.',
    ['요청 UI가 보인다', '취소가 반영된다', '남은 요청이 사라진다'],
  ),
  'accept-my-exchange': guide(
    'accept-my-exchange',
    'F',
    '지도 교환',
    '내 교환 요청 수락',
    '인형이 옆에서 기다리고 내가 보낸 요청을 수락합니다.',
    ['내 요청 UI가 보인다', '수락 결과를 확인한다', '지식이 확장된다'],
  ),
  'exchange-trace': guide(
    'exchange-trace',
    'F',
    '지도 교환',
    '지도 교환 흔적',
    '인형끼리 교환하고 술래 시점의 흔적을 확인합니다.',
    ['교환이 성립한다', '술래 화면에 흔적이 보인다', '흔적이 시야 규칙을 따른다'],
  ),
  'spectate-then-capture': guide(
    'spectate-then-capture',
    'G',
    '관전·결과·종료',
    '관전 후 포획',
    '나를 포획한 뒤 남은 인형까지 포획해 관전을 확인합니다.',
    ['관전 라벨이 보인다', '대상이 자동 전환된다', '관전 대상 선택이 동작한다'],
  ),
  'result-tagger-win': guide(
    'result-tagger-win',
    'G',
    '관전·결과·종료',
    '결과 화면 · 술래 승리',
    '술래 승리 결과 화면을 엽니다.',
    ['승리 문구를 확인한다', '포획·탈출 누계를 확인한다', '재경기 선택이 보인다'],
  ),
  'result-runner-win': guide(
    'result-runner-win',
    'G',
    '관전·결과·종료',
    '결과 화면 · 도망자 승리',
    '도망자 승리 결과 화면을 엽니다.',
    ['승리 문구를 확인한다', '포획·탈출 누계를 확인한다', '재경기 선택이 보인다'],
  ),
  'abort-connection-lost': guide(
    'abort-connection-lost',
    'G',
    '관전·결과·종료',
    '연결 상실 무효',
    '연결 상실로 라운드가 무효가 된 결과를 엽니다.',
    ['무효 사유를 확인한다', '재경기 안내를 확인한다', '일반 결과와 구분된다'],
  ),
};

const FAILURE_LABELS: Readonly<Record<string, string>> = {
  CELL_UNAVAILABLE: '배치할 수 없는 칸입니다.',
  NO_CHALLENGE_FROM_OPERATOR: '관리자의 도전이 시작되지 않았습니다.',
  NO_CROSSING_PATH: '가로지를 수 있는 경로가 없습니다.',
  NO_EXIT_FOR_PUPPET: '인형의 출구를 찾지 못했습니다.',
  NO_INSTALL_FROM_OPERATOR: '관리자가 장비를 설치하지 않았습니다.',
  NO_OPERATOR_EXIT: '관리자의 출구를 찾지 못했습니다.',
  NO_OPERATOR_STATE: '관리자 상태를 아직 확인할 수 없습니다.',
  NO_PUPPET: '선택한 역할의 인형이 없습니다.',
  NO_REQUEST_FROM_OPERATOR: '관리자의 교환 요청이 없습니다.',
  NO_ROOM_FOR_TWO_TRAPS: '연속으로 놓을 공간이 부족합니다.',
  NO_ROOM_TO_INSTALL: '장비를 설치할 공간이 없습니다.',
  OPERATOR_MUST_BE_RUNNER: '이 시나리오는 도망자일 때만 실행할 수 있습니다.',
  PATH_BLOCKED: '인형의 이동 경로가 막혔습니다.',
  TIMEOUT: '정해진 시간 안에 조건을 확인하지 못했습니다.',
  UNSUPPORTED_OPTION: '이 시나리오에서 지원하지 않는 선택입니다.',
};

const STEP_LABELS: Readonly<Record<string, string>> = {
  'await-condition': '조건을 기다리는 중',
  'chase-operator': '관리자에게 접근하는 중',
  completed: '완료 확인 중',
  install: '장비를 설치하는 중',
  place: '인형을 배치하는 중',
  setup: '시나리오를 준비하는 중',
  walk: '인형이 이동하는 중',
};

export function demoScenarioGuide(id: string): DemoScenarioGuide {
  return (
    DEMO_SCENARIO_GUIDE[id] ??
    guide(id, '?', '기타', id, '서버가 제공한 데모 시나리오입니다.', [
      '서버가 안내하는 결과를 확인한다',
    ])
  );
}

export function demoFailureLabel(failure: string): string {
  const code = failure.split(':').at(-1) ?? failure;
  return (
    FAILURE_LABELS[code] ?? '시나리오를 완료하지 못했습니다. 조건을 확인하고 다시 시도해 주세요.'
  );
}

export function demoStepLabel(step: string | null): string {
  if (!step) return '준비';
  return STEP_LABELS[step] ?? '진행 중';
}

export function demoFailureCodes(): readonly string[] {
  return Object.keys(FAILURE_LABELS);
}
