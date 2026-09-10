import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import type { ActiveSelf } from '@kkakkung/protocol/game-schema';
import { sampleSelf } from './action-interpolation';
import { CHARACTER } from './scene-model';
export const verticalFov = (aspect: number) =>
  (2 * Math.atan(Math.tan((40 * Math.PI) / 180) / Math.max(0.1, aspect)) * 180) / Math.PI;
export function FirstPersonCamera({
  self,
  renderTick,
}: {
  self: ActiveSelf;
  renderTick(): number | null;
}) {
  const size = useThree((state) => state.size);
  useFrame(({ camera }) => {
    const sample = sampleSelf(self, renderTick());
    camera.position.set(sample.x, CHARACTER.eyeHeight, sample.z);
    camera.rotation.set(0, sample.yaw, 0);
    if (camera instanceof PerspectiveCamera) {
      const aspect = size.width / Math.max(1, size.height);
      const fov = verticalFov(aspect);
      if (camera.aspect !== aspect || camera.fov !== fov) {
        camera.aspect = aspect;
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
  });
  return null;
}
