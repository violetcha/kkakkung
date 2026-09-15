// S15P21C204-223. 장비 형상 치수. 카메라 높이 0.8·수평 시야 80도는 고정이므로
// 인접 셀 바닥(시야 하단 한계 약 0.33–0.44)에 놓인 덫은 수직 요소로 시야에 올린다.
// 무장 상태는 색이 아니라 턱 돌출로 구분한다.
export const TRAP_MODEL = Object.freeze({
  plate: { width: 0.36, height: 0.032 },
  inner: { width: 0.24, height: 0.005 },
  jaw: { width: 0.026, depth: 0.28, offset: 0.145, armedHeight: 0.035, idleHeight: 0.008 },
  post: { radius: 0.012, height: 0.45 },
  lamp: { size: 0.04 },
});

export const trapJawHeight = (state: 'ARMED' | 'UNARMED') =>
  state === 'ARMED' ? TRAP_MODEL.jaw.armedHeight : TRAP_MODEL.jaw.idleHeight;

/** 바닥에서 표시등 윗면까지. */
export const trapTopHeight = () =>
  TRAP_MODEL.plate.height + TRAP_MODEL.post.height + TRAP_MODEL.lamp.size;
