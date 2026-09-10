import type { PoseKind, SensorSnapshot } from '../../input/InteractionRuntime';
/** Synthetic canonical landmarks for deterministic C tests, never camera evidence. */
export function poseFixture(time: number, kind: PoseKind = 'left', frameId = time): SensorSnapshot {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.8, z: 0, visibility: 1 }));
  landmarks[11] = { x: 0.7, y: 0.5, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.3, y: 0.5, z: 0, visibility: 1 };
  if (kind === 'left' || kind === 'y') {
    landmarks[13] = { x: 0.8, y: 0.3, z: 0, visibility: 1 };
    landmarks[15] = { x: 0.9, y: 0.1, z: 0, visibility: 1 };
  }
  if (kind === 'right' || kind === 'y') {
    landmarks[14] = { x: 0.2, y: 0.3, z: 0, visibility: 1 };
    landmarks[16] = { x: 0.1, y: 0.1, z: 0, visibility: 1 };
  }
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
