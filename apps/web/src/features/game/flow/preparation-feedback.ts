import type { PreparationIssue } from '@kkakkung/protocol/game-schema';

const LABELS: Record<PreparationIssue, string> = {
  SERVICE_NOT_READY: '서버가 아직 경기를 시작할 수 없습니다. 잠시 후 다시 준비해 주세요.',
  LAYOUT_UNAVAILABLE: '경기장을 준비하지 못했습니다. 모두 다시 준비를 눌러 재시도해 주세요.',
  DEVICE_LOADING_TIMEOUT:
    '제한 시간 안에 모든 참가자의 화면·카메라 연결을 준비하지 못했습니다. 장치와 네트워크를 확인한 뒤 다시 준비해 주세요.',
  MEDIA_NOT_READY:
    '연습 중 카메라·음성 연결을 준비하지 못했습니다. 장치 연결을 확인한 뒤 다시 준비해 주세요.',
  PREPARATION_UNAVAILABLE:
    '경기 준비에 실패했습니다. 잠시 후 다시 준비해 주세요. 반복되면 방을 다시 만들어 주세요.',
  // S15P21C204-364. 다시 준비해도 풀리지 않으므로 재시도를 권하지 않는다.
  MEDIA_BUDGET_EXHAUSTED:
    '이번 달 영상·음성 사용량이 한도에 가까워 새 경기를 시작할 수 없습니다. 진행 중인 경기는 영향이 없습니다. 운영자에게 알려 주세요.',
  // S15P21C204-372. 방은 남아 있고 자리가 나면 시작할 수 있다. 방장이 할 일을 말한다.
  MATCH_CAPACITY_FULL:
    '지금은 동시에 진행할 수 있는 경기가 모두 사용 중입니다. 방은 그대로 유지되니 자리가 나면 여기서 알려 드립니다.',
  // 대기열이 없으므로 먼저 시작한 방이 자리를 가져간다. 방장에게 지금 누르라고 알린다.
  MATCH_SLOT_AVAILABLE: '경기 자리가 났습니다. 방장이 지금 시작하면 바로 들어갑니다.',
};
export function preparationFeedback(issue: PreparationIssue | undefined): string | null {
  return issue ? (LABELS[issue] ?? null) : null;
}
