import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import type { Action, Cell, Dir } from '@kkakkung/protocol/game-schema';
import { worldActor } from './action-interpolation';
import { CHARACTER } from './scene-model';
export const verticalFov = (aspect: number) =>
  (2 * Math.atan(Math.tan((40 * Math.PI) / 180) / Math.max(0.1, aspect)) * 180) / Math.PI;
/**
 * 셀 중심에서 정확히 45도로 회전하는 순간 자기 셀 벽의 뒤쪽 끝 꼭짓점이 카메라 평면(w=0)에
 * 놓여 클리핑이 퇴화하고 벽이 질감 없는 평면으로 한 프레임 그려진다. 눈을 시선 방향으로 1mm
 * 앞당겨 그 꼭짓점이 항상 카메라 뒤에 있게 한다. 서버 좌표·이동 시간은 바꾸지 않는다.
 */
export const EYE_FORWARD_OFFSET = 0.001;
export function cameraPlacement(sample: { x: number; z: number; yaw: number }) {
  return {
    position: [
      sample.x - Math.sin(sample.yaw) * EYE_FORWARD_OFFSET,
      CHARACTER.eyeHeight,
      sample.z - Math.cos(sample.yaw) * EYE_FORWARD_OFFSET,
    ] as [number, number, number],
    rotation: [0, sample.yaw, 0] as [number, number, number],
  };
}
export function FirstPersonCamera({
  self,
  renderTick,
}: {
  self: { cell: Cell; dir: Dir; action?: Action | null };
  renderTick(): number | null;
}) {
  const size = useThree((state) => state.size);
  useFrame(({ camera }) => {
    const placement = cameraPlacement(worldActor(self, renderTick()));
    camera.position.set(...placement.position);
    camera.rotation.set(...placement.rotation);
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
