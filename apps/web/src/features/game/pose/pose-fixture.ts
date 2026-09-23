import type { PoseKind, SensorSnapshot } from '../../input/InteractionRuntime';

export type PoseFixtureShape = Readonly<{
  /** 들지 않은 팔의 팔꿈치·손목을 안 보이게 둔다. 책상 앞에 앉으면 흔한 프레이밍이다. */
  idleArmOffscreen?: boolean;
  /** 드는 팔의 팔꿈치·손목을 안 보이게 둔다. */
  raisedArmOffscreen?: boolean;
  /** 팔꿈치를 어깨 높이에 두고 팔뚝만 세운 "손 들기" 자세. */
  elbowAtShoulder?: boolean;
}>;

/** Synthetic canonical landmarks for deterministic C tests, never camera evidence. */
export function poseFixture(
  time: number,
  kind: PoseKind = 'left',
  frameId = time,
  shape: PoseFixtureShape = {},
): SensorSnapshot {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.8, z: 0, visibility: 1 }));
  landmarks[11] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
  const hidden = { x: 0.5, y: 0.8, z: 0, visibility: 0 };
  if (kind === 'left' || kind === 'y') {
    landmarks[13] = { x: 0.8, y: shape.elbowAtShoulder ? 0.52 : 0.3, z: 0, visibility: 1 };
    landmarks[15] = { x: 0.9, y: 0.1, z: 0, visibility: 1 };
  }
  if (kind === 'right' || kind === 'y') {
    landmarks[14] = { x: 0.2, y: shape.elbowAtShoulder ? 0.52 : 0.3, z: 0, visibility: 1 };
    landmarks[16] = { x: 0.1, y: 0.1, z: 0, visibility: 1 };
  }
  const raisedJoints = kind === 'right' ? [14, 16] : [13, 15];
  const idleJoints = kind === 'left' ? [14, 16] : kind === 'right' ? [13, 15] : [];
  if (shape.raisedArmOffscreen) for (const index of raisedJoints) landmarks[index] = hidden;
  if (shape.idleArmOffscreen) for (const index of idleJoints) landmarks[index] = hidden;
  return {
    runtimeGeneration: 1,
    emittedAtMs: time,
    face: null,
    gesture: null,
    pose: {
      frameId,
      sampledAtMs: time,
      receivedAtMs: time,
      status: 'valid',
      data: { quality: 'valid', landmarks },
    },
  };
}
