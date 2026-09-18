// S15P21C204-273. 장치 점검 '자세' 단계에서 기울이기·고개 돌리기를 각 1회 봤는지만 기록한다.
// 임계값을 새로 정하지 않고 입력 층이 그때 쓰던 값(state.thresholds)을 그대로 읽는다.
// 조작 판정에는 쓰지 않는다. 화면 안내와 단계 진행 표시에만 쓴다.
import type { MotionDebugState } from '../../input/motion-debug';

export type MotionCheck = Readonly<{ lean: boolean; turn: boolean }>;

export const NO_MOTION_CHECK: MotionCheck = Object.freeze({ lean: false, turn: false });

/** 두 확인이 모두 끝났는지. 신호가 없으면(null) 확인을 요구하지 않는다. */
export const motionCheckDone = (check: MotionCheck | null | undefined): boolean =>
  !check || (check.lean && check.turn);

/**
 * 보정 전에는 상대값이 없으므로 기록을 비운다. 다시 보정하면 확인도 처음부터 다시 받는다.
 * 값이 바뀌지 않으면 같은 객체를 돌려주어 화면 갱신을 만들지 않는다.
 */
export function observeMotionCheck(current: MotionCheck, state: MotionDebugState): MotionCheck {
  if (!state.calibrated) return current === NO_MOTION_CHECK ? current : NO_MOTION_CHECK;
  const lean =
    current.lean ||
    (state.leanRelative !== null && state.leanRelative >= state.thresholds.forwardEnter);
  const turn =
    current.turn ||
    (state.yawRelative !== null && Math.abs(state.yawRelative) >= state.thresholds.turnEnter);
  return lean === current.lean && turn === current.turn ? current : Object.freeze({ lean, turn });
}
