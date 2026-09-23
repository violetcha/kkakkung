import type { PoseKind, PoseSensor, SensorSnapshot } from '../../input/InteractionRuntime';

/** 표본이 이 나이를 넘으면 쓰지 않는다. `POSE_MAX_AGE_MS` 와 같은 값이다. */
const MAX_AGE_MS = 300;

/**
 * 연속한 두 유효 표본 사이에서 유지 시간으로 인정하는 최대 간격. 이보다 벌어지면 표본 흐름
 * 자체가 끊긴 것이므로 누적을 버린다. 자세가 깨진 짧은 순간의 관용은 아래 GRACE 가 맡는다.
 */
export const POSE_HOLD_MAX_STEP_MS = 300;

/**
 * S15P21C204-354. 자세가 한 프레임 깨졌다고 1.2초를 처음부터 다시 채우게 하지 않는다. 이
 * 시간 안에 자세가 돌아오면 누적을 유지하되 **깨져 있던 구간은 유지 시간으로 세지 않는다**.
 * 6인 서버 시험에서 팔 관절 visibility 가 경계에서 깜빡일 때마다 진행이 0으로 떨어져,
 * 실제로는 자세를 계속 잡고 있어도 판정이 서지 않았다.
 */
export const POSE_HOLD_GRACE_MS = 200;

/** 자세가 서지 않는 이유. 화면 안내는 이 코드를 문구로 옮긴다(판정기는 문구를 모른다). */
export type PoseMissReason =
  | 'sensor' // 쓸 수 있는 자세 표본이 없다
  | 'trunk' // 코·양 어깨가 안 보인다
  | 'arm-offscreen' // 들어야 하는 팔의 팔꿈치·손목이 화면 밖이다
  | 'arm-low' // 팔은 보이는데 충분히 올라가지 않았다
  | 'arm-spread' // Y자인데 두 팔이 벌어지지 않았다
  | 'other-arm'; // 한 팔만 드는 자세인데 반대 팔도 올라가 있다

export type PoseMatch = Readonly<{ matched: boolean; reason: PoseMissReason | null }>;

const MATCHED: PoseMatch = Object.freeze({ matched: true, reason: null });
const miss = (reason: PoseMissReason): PoseMatch => ({ matched: false, reason });

/** Canonical left/right indices from D; horizontal mirroring never swaps the user's arm. */
const JOINTS = Object.freeze({ ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16 });

type Landmark = PoseSensor['landmarks'][number];

function usable(point: Landmark | undefined): point is Landmark {
  return (
    !!point &&
    point.visibility >= 0.5 &&
    [point.x, point.y, point.z, point.visibility].every(Number.isFinite)
  );
}

/**
 * 한쪽 팔의 상태. y 는 아래로 커진다(위가 작다).
 *
 * `up` 조건 세 가지:
 * 1. 손목이 어깨보다 `margin` 위 — 팔을 들었다는 최소 조건
 * 2. 손목이 팔꿈치보다 위 — 팔뚝이 위를 향한다(손만 어깨에 얹은 자세를 거른다)
 * 3. 팔꿈치가 어깨보다 `margin` 아래까지만 허용
 *
 * 3 은 예전에 `팔꿈치 y < 어깨 y`(여유 0)였다. 사람들이 흔히 하는 "손 들기"(팔꿈치를 어깨
 * 높이에 두고 팔뚝만 세우는 자세)는 팔꿈치 y 가 어깨와 거의 같아 프레임마다 참·거짓을 오갔다.
 */
function armState(
  shoulder: Landmark,
  elbow: Landmark | undefined,
  wrist: Landmark | undefined,
  margin: number,
) {
  if (!usable(elbow) || !usable(wrist)) return { visible: false, up: false };
  return {
    visible: true,
    up: wrist.y < shoulder.y - margin && wrist.y < elbow.y && elbow.y < shoulder.y + margin,
  };
}

/**
 * 지정 자세가 이 프레임에서 성립하는지와, 아니라면 왜 아닌지.
 *
 * S15P21C204-354. 한 팔만 드는 자세는 **드는 쪽 팔 관절만** 요구한다. 예전에는 11~16 여섯
 * 관절을 모두 요구해서, 내린 팔의 손목이 책상 아래로 나가는 흔한 자리에서 자세가 맞아도
 * 판정이 서지 않았다(S15P21C204-344 가 안내 문구로 덮었던 증상). 반대쪽 팔은 **보일 때만**
 * 배제 규칙을 적용한다 — 안 보이면 든 것이 아니다.
 */
export function evaluatePose(pose: PoseSensor, kind: PoseKind): PoseMatch {
  if (pose.quality !== 'valid') return miss('trunk');
  const ls = pose.landmarks[JOINTS.ls];
  const rs = pose.landmarks[JOINTS.rs];
  if (!usable(ls) || !usable(rs)) return miss('trunk');
  const margin = Math.max(0.04, Math.abs(ls.x - rs.x) * 0.2);
  const left = armState(ls, pose.landmarks[JOINTS.le], pose.landmarks[JOINTS.lw], margin);
  const right = armState(rs, pose.landmarks[JOINTS.re], pose.landmarks[JOINTS.rw], margin);
  if (kind === 'left' || kind === 'right') {
    const target = kind === 'left' ? left : right;
    const other = kind === 'left' ? right : left;
    if (!target.visible) return miss('arm-offscreen');
    if (!target.up) return miss('arm-low');
    // 반대 팔은 보일 때만 본다. 안 보이면 들지 않은 것으로 읽는다.
    if (other.visible && other.up) return miss('other-arm');
    return MATCHED;
  }
  if (!left.visible || !right.visible) return miss('arm-offscreen');
  if (!left.up || !right.up) return miss('arm-low');
  const lw = pose.landmarks[JOINTS.lw];
  const rw = pose.landmarks[JOINTS.rw];
  if (!usable(lw) || !usable(rw)) return miss('arm-offscreen');
  // 두 손목이 각자 바깥쪽(자기 어깨가 반대 어깨에서 벗어난 방향)으로 나가 있어야 Y자다.
  const spread = (lw.x - ls.x) * (ls.x - rs.x) > 0 && (rw.x - rs.x) * (rs.x - ls.x) > 0;
  return spread ? MATCHED : miss('arm-spread');
}

export function matchesPose(pose: PoseSensor, kind: PoseKind) {
  return evaluatePose(pose, kind).matched;
}

export function createPoseHold() {
  /** 유지 시간으로 인정한 마지막 표본의 sampledAtMs. */
  let lastSampleMs: number | null = null;
  /** 그 표본을 본 관측 시각. 관용 시간은 표본 시각이 아니라 이쪽으로 잰다. */
  let lastMatchNow: number | null = null;
  /** 관용 구간에 들어가 있는지. 돌아온 첫 프레임의 간격은 시간으로 세지 않는다. */
  let paused = false;
  let frame = -1;
  let generation = -1;
  let heldMs = 0;
  let reason: PoseMissReason | null = 'sensor';
  const resetHold = () => {
    lastSampleMs = null;
    lastMatchNow = null;
    paused = false;
    heldMs = 0;
  };
  return {
    observe(
      snapshot: SensorSnapshot | null,
      expectedGeneration: number,
      kind: PoseKind,
      now: number,
    ) {
      if (generation !== expectedGeneration) {
        generation = expectedGeneration;
        frame = -1;
        resetHold();
      }
      const sample = snapshot?.pose;
      if (
        !snapshot ||
        snapshot.runtimeGeneration !== expectedGeneration ||
        !sample ||
        sample.status !== 'valid' ||
        now < sample.sampledAtMs ||
        now - sample.sampledAtMs > MAX_AGE_MS
      ) {
        reason = 'sensor';
        if (lastMatchNow === null || now - lastMatchNow > POSE_HOLD_GRACE_MS) resetHold();
        else paused = true;
        return { heldMs, freshFrame: false, reason };
      }
      const match = evaluatePose(sample.data, kind);
      if (!match.matched) {
        reason = match.reason;
        if (lastMatchNow === null || now - lastMatchNow > POSE_HOLD_GRACE_MS) resetHold();
        else paused = true;
        return { heldMs, freshFrame: false, reason };
      }
      reason = null;
      if (sample.frameId <= frame) return { heldMs, freshFrame: false, reason };
      frame = sample.frameId;
      const previous = lastSampleMs;
      if (previous !== null && sample.sampledAtMs - previous > POSE_HOLD_MAX_STEP_MS) {
        // 표본 흐름이 끊겼다. 관용은 자세가 깨진 짧은 순간에만 주고 여기서는 주지 않는다.
        resetHold();
      } else if (previous !== null && !paused && sample.sampledAtMs > previous) {
        heldMs += sample.sampledAtMs - previous;
      }
      paused = false;
      lastSampleMs = sample.sampledAtMs;
      lastMatchNow = now;
      return { heldMs, freshFrame: true, reason };
    },
    reset() {
      resetHold();
      frame = -1;
      generation = -1;
      reason = 'sensor';
    },
  };
}

/** 안내 문구를 붙잡아 두는 최소 시간. 이보다 짧게 스친 이유는 화면에 올리지 않는다. */
export const POSE_HINT_SETTLE_MS = 500;

/**
 * 순간 신호를 화면에 그대로 물리지 않는다(S15P21C204-330·344 와 같은 실수). 같은 이유가
 * 연속으로 `POSE_HINT_SETTLE_MS` 이상 이어질 때만 문구로 올리고, 이유가 바뀌면 다시 잰다.
 * 자세가 서면 즉시 지운다 — 맞는 자세를 잡고 있는데 경고가 남아 있으면 더 혼란스럽다.
 */
export function createPoseHint() {
  let shown: PoseMissReason | null = null;
  let pending: PoseMissReason | null = null;
  let since = 0;
  return {
    observe(reason: PoseMissReason | null, now: number): PoseMissReason | null {
      if (reason === null) {
        pending = null;
        shown = null;
        return null;
      }
      if (reason !== pending) {
        pending = reason;
        since = now;
      }
      if (now - since >= POSE_HINT_SETTLE_MS) shown = reason;
      return shown;
    },
    reset() {
      shown = null;
      pending = null;
      since = 0;
    },
  };
}
