import { expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { cameraPlacement } from './FirstPersonCamera';
import { CHARACTER } from './scene-model';
import { sampleSelf } from './action-interpolation';

/** 카메라 시점에서 본 점의 깊이(앞이면 음수 z). */
function viewDepth(sample: ReturnType<typeof sampleSelf>, point: Vector3) {
  const camera = new PerspectiveCamera();
  const placement = cameraPlacement(sample);
  camera.position.set(...placement.position);
  camera.rotation.set(...placement.rotation);
  camera.updateMatrixWorld(true);
  return point.clone().applyMatrix4(new Matrix4().copy(camera.matrixWorldInverse)).z;
}

it('never leaves a wall corner exactly on the camera plane mid-turn', () => {
  // 셀 중심에서 45도로 회전하면 자기 셀 벽의 뒤쪽 끝(±0.5, ±0.5)이 카메라 평면(w=0)에 정확히
  // 놓여 클리핑이 퇴화하고 벽이 질감 없는 평면으로 그려진다. 그 꼭짓점은 항상 뒤(양수 z)여야 한다.
  const self = {
    cell: { x: 0, y: 0 },
    dir: 0 as const,
    action: {
      kind: 'turn' as const,
      from: { x: 0, y: 0, dir: 0 as const },
      to: { x: 0, y: 0, dir: 1 as const },
      startTick: 0,
      endTick: 20,
    },
  };
  for (const tick of [10, 30, 50]) {
    const sample = sampleSelf({ ...self, action: { ...self.action, endTick: tick * 2 } }, tick);
    for (const corner of [new Vector3(0.5, 0.6, 0.5), new Vector3(-0.5, 0.6, -0.5)])
      expect(viewDepth(sample, corner)).toBeGreaterThan(1e-4);
  }
});

it('keeps the eye at character height and within a millimetre of the interpolated cell', () => {
  const placement = cameraPlacement({ x: 3, z: -2, yaw: 0.3 });
  expect(placement.position[1]).toBe(CHARACTER.eyeHeight);
  expect(Math.hypot(placement.position[0] - 3, placement.position[2] + 2)).toBeLessThan(0.002);
  expect(placement.rotation).toEqual([0, 0.3, 0]);
});
