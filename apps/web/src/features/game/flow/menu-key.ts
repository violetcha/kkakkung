/**
 * S15P21C204-379. 방 안 설정 창과 혼자 연습 메뉴를 여닫는 Esc. 탈출 도전 중 Esc 는 입력 런타임의
 * 도전 취소가 먼저라 창을 건드리지 않는다. 한 번 누름에 두 가지가 일어나지 않게 한다.
 */
export function togglesMenu(
  event: Pick<KeyboardEvent, 'key' | 'repeat'>,
  challengeActive: boolean,
): boolean {
  return event.key === 'Escape' && !event.repeat && !challengeActive;
}
