import { expect, it } from 'vitest';
import type { MotionDebugState } from '../../input/motion-debug';
import { NO_MOTION_CHECK, motionCheckDone, observeMotionCheck } from './motion-check';

const state = (patch: Partial<MotionDebugState>): MotionDebugState =>
  ({
    atMs: 0,
    calibrated: true,
    neutral: { yawRad: 0, shoulderSpan: 1, faceSpan: 1 },
    poseUsable: true,
    faceUsable: true,
    components: { shoulder: null, face: null },
    shoulderRelative: null,
    faceRelative: null,
    leanRelative: null,
    yawRaw: null,
    yawRelative: null,
    leanGatedByYaw: false,
    move: 'idle',
    motionActive: false,
    turnLatched: false,
    mode: 'motion',
    accepting: false,
    thresholds: {
      forwardEnter: 0.1,
      forwardExit: 0.05,
      backEnter: -0.1,
      backExit: -0.05,
      turnEnter: 0.4,
      turnExit: 0.2,
    },
    ...patch,
  }) as MotionDebugState;

it('records a forward lean and a head turn once each and then keeps them', () => {
  let check = NO_MOTION_CHECK;
  check = observeMotionCheck(check, state({ leanRelative: 0.04, yawRelative: 0.1 }));
  expect(check).toEqual({ lean: false, turn: false });
  check = observeMotionCheck(check, state({ leanRelative: 0.12, yawRelative: 0.1 }));
  expect(check).toEqual({ lean: true, turn: false });
  // 기울임이 중립으로 돌아와도 이미 본 확인은 남는다.
  check = observeMotionCheck(check, state({ leanRelative: 0, yawRelative: -0.5 }));
  expect(check).toEqual({ lean: true, turn: true });
  expect(motionCheckDone(check)).toBe(true);
});

it('accepts a head turn in either direction and ignores one below the threshold', () => {
  const left = observeMotionCheck(NO_MOTION_CHECK, state({ yawRelative: -0.4 }));
  const right = observeMotionCheck(NO_MOTION_CHECK, state({ yawRelative: 0.4 }));
  expect(left.turn && right.turn).toBe(true);
  expect(observeMotionCheck(NO_MOTION_CHECK, state({ yawRelative: 0.39 })).turn).toBe(false);
});

it('clears the record when there is no usable calibration and returns the same object otherwise', () => {
  const seen = observeMotionCheck(NO_MOTION_CHECK, state({ leanRelative: 1, yawRelative: 1 }));
  expect(seen).toEqual({ lean: true, turn: true });
  expect(observeMotionCheck(seen, state({ calibrated: false }))).toBe(NO_MOTION_CHECK);
  // 값이 그대로면 화면 갱신을 만들지 않는다.
  expect(observeMotionCheck(seen, state({ leanRelative: 1, yawRelative: 1 }))).toBe(seen);
  expect(observeMotionCheck(NO_MOTION_CHECK, state({ calibrated: false }))).toBe(NO_MOTION_CHECK);
});

it('does not demand confirmations when no motion signal is available', () => {
  expect(motionCheckDone(null)).toBe(true);
  expect(motionCheckDone(undefined)).toBe(true);
  expect(motionCheckDone(NO_MOTION_CHECK)).toBe(false);
});
