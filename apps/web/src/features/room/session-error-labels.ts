// 세션 발급 오류를 참가자가 할 일로 옮긴다. 서버 코드 목록(`SESSION_ERROR_CODES`)을 그대로 키로
// 삼아, 코드가 늘면 문구가 빠진 채 "연결할 수 없습니다"로 떨어지지 않고 타입 검사에서 걸린다.
import type { SessionErrorCode } from '@kkakkung/protocol/game-messages';

const LABELS: Record<SessionErrorCode, string> = {
  INVALID_REQUEST: '닉네임·초대 링크·방 코드를 확인해 주세요.',
  INVALID_INVITATION: '유효한 초대 링크가 필요합니다.',
  ROOM_NOT_AVAILABLE: '입장할 수 없는 방입니다.',
  RATE_LIMITED: '잠시 기다린 뒤 다시 시도해 주세요.',
  ADMISSION_CLOSED: '지금은 입장을 받고 있지 않습니다.',
  // S15P21C204-365. 서비스가 찬 것과 그 방이 찬 것은 할 일이 달라 문구를 나눈다.
  CAPACITY: '지금은 열 수 있는 방이 모두 사용 중입니다. 잠시 뒤 다시 시도해 주세요.',
  ROOM_FULL: '이 방은 인원이 모두 찼습니다. 방 코드를 확인하거나 새 방을 만들어 주세요.',
  TOO_MANY_ROOMS: '이미 열어 둔 방이 있습니다. 쓰지 않는 방을 닫거나 잠시 뒤 다시 시도해 주세요.',
};

/** 세션이 끊긴 뒤 다시 들어올 때 클라이언트가 스스로 내는 코드. 서버 목록에는 없다. */
const CLIENT_LABELS: Readonly<Record<string, string>> = {
  INVALID_SESSION: '입장 시간이 만료됐습니다. 다시 입장해 주세요.',
};

export function sessionErrorLabel(
  code: string,
  context: Readonly<{ ssoWithoutInvitation: boolean }>,
): string | null {
  // SSO 로 들어왔는데 초대 링크가 없으면 초대가 아니라 로그인이 문제다.
  if (code === 'INVALID_INVITATION' && context.ssoWithoutInvitation)
    return '로그인을 확인할 수 없습니다. 페이지를 새로고침해 다시 로그인해 주세요.';
  return (LABELS as Readonly<Record<string, string>>)[code] ?? CLIENT_LABELS[code] ?? null;
}
