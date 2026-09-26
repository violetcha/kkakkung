/**
 * S15P21C204-379. 방 안 설정 창과 혼자 연습 메뉴를 여닫는 Esc. 탈출 도전 중 Esc 는 입력 런타임의
 * 도전 취소가 먼저라 창을 건드리지 않는다. 한 번 누름에 두 가지가 일어나지 않게 한다.
 *
 * S15P21C204-402. 글자를 치는 칸과 드롭다운에서 누른 Esc 도 창을 건드리지 않는다. 드롭다운을
 * Esc 로 닫으면 설정 창까지 함께 열렸다. 음량 막대·체크 칸처럼 글자를 치지 않는 입력은 그대로
 * 창을 여닫는다.
 */
export function togglesMenu(
  event: Pick<KeyboardEvent, 'key' | 'repeat'> & { target?: EventTarget | null },
  challengeActive: boolean,
): boolean {
  return (
    event.key === 'Escape' && !event.repeat && !challengeActive && !ownsEscape(event.target ?? null)
  );
}

const NON_TEXT_INPUTS = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'color',
]);

/** 이 요소가 Esc 를 스스로 쓰는지(글자 입력 칸·드롭다운·편집 가능한 영역). */
function ownsEscape(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT')
    return !NON_TEXT_INPUTS.has(typeof element.type === 'string' ? element.type : 'text');
  return element.isContentEditable === true;
}
