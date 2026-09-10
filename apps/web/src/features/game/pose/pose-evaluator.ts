import type { PoseKind, PoseSensor, SensorSnapshot } from '../../input/InteractionRuntime';

/** Canonical left/right indices from D; horizontal mirroring never swaps the user's arm. */
export function matchesPose(pose: PoseSensor, kind: PoseKind) {
  if (pose.quality !== 'valid') return false;
  const points = [11, 12, 13, 14, 15, 16].map((index) => pose.landmarks[index]);
  if (
    points.some(
      (p) => !p || p.visibility < 0.5 || ![p.x, p.y, p.z, p.visibility].every(Number.isFinite),
    )
  )
    return false;
  const [ls, rs, le, re, lw, rw] = points as [
    NonNullable<(typeof points)[number]>,
    NonNullable<(typeof points)[number]>,
    NonNullable<(typeof points)[number]>,
    NonNullable<(typeof points)[number]>,
    NonNullable<(typeof points)[number]>,
    NonNullable<(typeof points)[number]>,
  ];
  const margin = Math.max(0.04, Math.abs(ls.x - rs.x) * 0.2);
  const left = lw.y < ls.y - margin && le.y < ls.y;
  const right = rw.y < rs.y - margin && re.y < rs.y;
  if (kind === 'left') return left && !right;
  if (kind === 'right') return right && !left;
  return left && right && (lw.x - ls.x) * (ls.x - rs.x) > 0 && (rw.x - rs.x) * (rs.x - ls.x) > 0;
}

export function createPoseHold() {
  let start: number | null = null;
  let lastTime: number | null = null;
  let frame = -1;
  let generation = -1;
  let heldMs = 0;
  const resetHold = () => {
    start = null;
    lastTime = null;
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
        now - sample.sampledAtMs > 300 ||
        !matchesPose(sample.data, kind)
      ) {
        resetHold();
        return { heldMs, freshFrame: false };
      }
      if (sample.frameId <= frame) return { heldMs, freshFrame: false };
      frame = sample.frameId;
      if (
        lastTime === null ||
        sample.sampledAtMs <= lastTime ||
        sample.sampledAtMs - lastTime > 300
      )
        start = sample.sampledAtMs;
      lastTime = sample.sampledAtMs;
      heldMs = Math.max(0, sample.sampledAtMs - (start ?? sample.sampledAtMs));
      return { heldMs, freshFrame: true };
    },
    reset() {
      resetHold();
      frame = -1;
      generation = -1;
    },
  };
}
