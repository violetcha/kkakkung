import type { RequestDisplay } from '../../room/command-lifecycle';

export function commandFeedback(request: RequestDisplay | undefined | null): string | null {
  if (!request || request.status === 'applied' || request.status === 'pending') return null;
  if (request.status === 'waiting-view') return '처리가 끝나 갱신된 화면을 기다리고 있습니다.';
  if (request.status === 'unconfirmed')
    return '응답을 확인하지 못했습니다. 화면의 현재 상태를 확인한 뒤 다시 시도해 주세요.';
  if (request.code === 'RATE_LIMITED')
    return '요청이 너무 빠릅니다. 잠시 기다린 뒤 다시 시도해 주세요.';
  if (request.code === 'INVALID_PHASE' || request.code === 'ROUND_ENDED')
    return '경기 단계가 바뀌었습니다. 현재 화면에서 가능한 행동을 선택해 주세요.';
  if (request.code === 'NOT_ACTIVE') return '참가가 종료되어 이 행동을 할 수 없습니다.';
  if (request.code === 'EXPIRED' || request.code === 'STALE_REQUEST')
    return '요청 시간이 지났습니다. 현재 상태를 확인하고 새로 요청해 주세요.';
  if (request.status === 'canceled') return '요청이 취소되었습니다.';
  if (request.type === 'ROOM_LOCK' || request.type === 'ROOM_KICK')
    return '방 관리를 처리하지 못했습니다. 현재 방장과 참가자, 대기 단계를 확인해 주세요.';
  if (request.type === 'EXCHANGE_REQUEST' || request.type === 'EXCHANGE_ACCEPT')
    return '지도를 교환하지 못했습니다. 바로 옆 도망자 아군과 서로 다른 지도 정보가 있어야 하며, 구속·탈출 동작 중에는 교환할 수 없습니다.';
  if (request.type === 'INSTALL')
    return '설치하지 못했습니다. 이동을 멈추고 남은 장비와 설치 위치를 확인해 주세요.';
  if (request.type === 'REMATCH')
    return '재경기를 시작하지 못했습니다. 방장과 현재 참가자를 확인한 뒤 다시 시도해 주세요.';
  return '지금은 이 행동을 할 수 없습니다. 현재 상태를 확인한 뒤 다시 시도해 주세요.';
}
