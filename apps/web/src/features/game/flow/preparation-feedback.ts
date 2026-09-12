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
};
export function preparationFeedback(issue: PreparationIssue | undefined): string | null {
  return issue ? (LABELS[issue] ?? null) : null;
}
