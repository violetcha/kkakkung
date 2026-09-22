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
    '인형 또는 내가 덫을 설치하고 발동까지 확인합니다. 설치자를 "나"로 두면 내가 F 로 놓을 때까지 기다립니다.',
    ['설치 십자선과 핫바 힌트를 확인한다', '무장 대기를 확인한다', '발동 흔적과 소모를 확인한다'],
    ['installer'],
  ),
  sensor: guide(
    'sensor',
    'C',
    '술래 장비',
    '감지기 설치',
    '인형 또는 내가 감지기를 설치하고 유지 상태를 확인합니다. 설치자를 "나"로 두면 벽을 보게 세워 둔 뒤 내가 F 로 놓기를 기다립니다.',
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
    '인형이 출구 도전을 시작하면 그 옆으로 나를 옮깁니다. 잡기(G)로 잡으세요.',
    ['도전이 진행 중이다', '잡기로 포획된다', '도전이 취소된다'],
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
  CANCELED: '관리자가 시나리오를 내렸습니다.',
  FAILED: '규칙이 이 동작을 받아들이지 않았습니다.',
  NEED_ONE_PAIR: '술래 인형과 도망자 인형이 한 쌍 필요합니다.',
  NEED_TWO_PAIRS: '술래 인형과 도망자 인형이 두 쌍 필요합니다.',
  NEED_TWO_RUNNER_PUPPETS: '살아 있는 도망자 인형이 둘 필요합니다.',
  NO_CHALLENGE_FROM_OPERATOR: '관리자의 도전이 시작되지 않았습니다.',
  NO_CROSSING_PATH: '가로지를 수 있는 경로가 없습니다.',
  NO_EXCHANGE_PARTNER: '이미 지도를 나눈 인형뿐입니다. 서로 모르는 곳이 있어야 교환할 수 있습니다.',
  NO_EXIT_FOR_PUPPET: '인형의 출구를 찾지 못했습니다.',
  NO_INSTALL_FROM_OPERATOR: '관리자가 장비를 설치하지 않았습니다.',
  NO_OPERATOR_EXIT: '관리자의 출구를 찾지 못했습니다.',
  NO_OPERATOR_STATE: '관리자 상태를 아직 확인할 수 없습니다.',
  NO_PUPPET: '선택한 역할의 인형이 없습니다.',
  NO_REQUEST_FROM_OPERATOR: '관리자의 교환 요청이 없습니다.',
  NO_ROOM_FOR_TWO_TRAPS: '연속으로 놓을 공간이 부족합니다.',
  NO_ROOM_TO_INSTALL: '장비를 설치할 공간이 없습니다.',
  NO_ROOM_TO_RETREAT: '설치한 인형이 물러날 칸이 없습니다.',
  NO_RUNNER_PUPPET: '살아 있는 도망자 인형이 없습니다.',
  NO_TAGGER_PUPPET: '술래 인형이 없습니다.',
  NO_WALL_TO_MOUNT: '감지기를 붙일 벽이 없습니다.',
  OPERATOR_MUST_BE_RUNNER: '이 시나리오는 도망자일 때만 실행할 수 있습니다.',
  OPERATOR_MUST_BE_TAGGER: '이 시나리오는 술래일 때만 실행할 수 있습니다.',
  OPERATOR_NOT_ACTIVE: '관리자가 이미 포획되었거나 탈출해 실행할 수 없습니다.',
  PATH_BLOCKED: '인형의 이동 경로가 막혔습니다.',
  TIMEOUT: '정해진 시간 안에 조건을 확인하지 못했습니다.',
  UNSUPPORTED_OPTION: '이 시나리오에서 지원하지 않는 선택입니다.',
};

/** S15P21C204-313. 서버 대본의 단계 이름(`server/src/rooms/DemoScenarios.ts`)과 같은 키다. */
const STEP_LABELS: Readonly<Record<string, string>> = {
  'accept-exchange': '인형이 교환을 수락하는 중',
  'approach-exit': '인형이 출구로 가는 중',
  'cancel-exchange': '인형이 교환 요청을 취소하는 중',
  'capture-operator': '술래 인형이 나를 잡으러 오는 중',
  'capture-watched': '술래 인형이 관전 대상을 잡으러 가는 중',
  'clear-exit': '출구 앞에 선 인형을 비키는 중',
  'chase-operator': '관리자에게 접근하는 중',
  'come-closer': '인형이 옆으로 오는 중',
  cross: '인형이 시야를 가로지르는 중',
  'drop-connection': '인형의 연결을 끊는 중',
  'face-exit': '인형이 출구를 보는 중',
  'face-operator': '인형이 나를 보는 중',
  'face-wall': '인형이 벽을 보는 중',
  'first-comes-closer': '첫 인형이 다가오는 중',
  'hold-challenge': '인형이 도전 중입니다 · 잡기(G)로 잡으세요',
  'show-my-challenge': '내 도전 화면을 보여 주는 중',
  'stand-beside-challenge': '도전 중인 인형 옆으로 나를 옮기는 중',
  install: '장비를 설치하는 중',
  'make-room-beside-me': '내 옆자리를 비우는 중',
  'move-to-side': '인형이 옆 칸으로 비키는 중',
  'offer-pending': '교환 요청이 열리기를 기다리는 중',
  'offer-shown': '교환 요청을 보여 주는 중',
  'operator-installs': '내가 장비를 놓고 무장하기를 기다리는 중',
  'operator-requests': '내 교환 요청을 기다리는 중',
  'operator-starts-challenge': '내가 출구 도전을 시작하기를 기다리는 중',
  'place-at-exit': '나를 출구 앞으로 옮기는 중',
  'place-puppet': '인형을 배치하는 중',
  'request-exchange': '인형이 교환을 요청하는 중',
  'runner-enters': '도망자 인형이 들어오는 중',
  'second-joins': '두 번째 인형이 합류하는 중',
  'show-armed': '무장된 상태를 보여 주는 중',
  'stand-where-i-can-install': '장비를 놓을 수 있는 자리로 나를 옮기는 중',
  'show-spent': '소모된 상태를 보여 주는 중',
  'show-unarmed': '무장 전 상태를 보여 주는 중',
  'start-challenge': '인형이 출구 도전을 시작하는 중',
  'step-aside-for-runner': '장비 칸에서 내가 비키는 중',
  'step-back': '설치한 인형이 물러나는 중',
  'trace-visible': '교환 흔적을 보여 주는 중',
  'wait-armed': '장비가 무장되기를 기다리는 중',
  'wait-beside-exit': '술래 인형이 출구 옆에서 기다리는 중',
  'wait-for-spectating': '관전 화면으로 넘어가기를 기다리는 중',
  'wait-offer-clear': '앞선 교환 요청이 사라지기를 기다리는 중',
  'walk-to-spot': '인형이 자리로 가는 중',
};

/** 인형·장비마다 뒤에 식별자가 붙는 단계. 긴 접두어부터 맞춘다. */
const STEP_PREFIX_LABELS: readonly (readonly [string, string])[] = [
  ['walk-to-trap-', '덫 자리로 가는 중'],
  ['install-trap-', '덫을 설치하는 중'],
  ['face-exit-', '인형이 출구를 보는 중'],
  ['arm-trap-', '덫이 무장되기를 기다리는 중'],
  ['approach-', '인형이 다가가는 중'],
  ['capture-', '술래 인형이 잡으러 가는 중'],
  ['complete-', '인형이 탈출을 마치는 중'],
  ['escaped-', '인형의 탈출을 확인하는 중'],
  ['start-', '인형이 출구 도전을 시작하는 중'],
  ['hold-', '인형이 탈출 자세를 유지하는 중'],
  ['turn-', '인형이 방향을 바꾸는 중'],
];

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

/**
 * S15P21C204-342. 중단 문구는 이유만 보여 줘서 어느 단계에서 멈췄는지 알 수 없었다. 서버가
 * `<단계>:<이유>` 로 보내므로 단계 라벨을 앞에 붙인다. 단계를 모르는 코드는 이유만 보여 준다.
 */
export function demoFailureDetail(failure: string): string {
  const parts = failure.split(':');
  const reason = demoFailureLabel(failure);
  if (parts.length < 2) return reason;
  const step = demoStepLabel(parts.slice(0, -1).join(':'));
  return step === '진행 중' ? reason : `${step} — ${reason}`;
}

export function demoStepLabel(step: string | null): string {
  if (!step) return '준비';
  return (
    STEP_LABELS[step] ??
    STEP_PREFIX_LABELS.find(([prefix]) => step.startsWith(prefix))?.[1] ??
    '진행 중'
  );
}

export function demoFailureCodes(): readonly string[] {
  return Object.keys(FAILURE_LABELS);
}

/** 라벨이 있는 단계 이름. 서버 대본과 맞는지 계약 시험이 본다. */
export function demoStepLabelKeys(): readonly string[] {
  return [...Object.keys(STEP_LABELS), ...STEP_PREFIX_LABELS.map(([prefix]) => prefix)];
}
