import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import type { Action, Cell, Dir } from '@kkakkung/protocol/game-schema';
import { worldActor } from './action-interpolation';
import { BLOCK, BLOCK_LIGHTING } from './block-theme';

/**
 * S15P21C204-268. The block theme has one light: the lantern in the player's hand, plus a
 * faint ambient so the darkness has a floor. No hemisphere or directional light, so the maze is
 * never lit beyond the lantern's reach; the fog ends before the server's sight does.
 */
export function BlockLighting({
  self,
  renderTick,
}: {
  self: { cell: Cell; dir: Dir; action?: Action | null };
  renderTick(): number | null;
}) {
  const carrier = useRef<Group>(null);
  useFrame(() => {
    const sample = worldActor(self, renderTick());
    carrier.current?.position.set(sample.x, 0, sample.z);
    carrier.current?.rotation.set(0, sample.yaw, 0);
  });
  const [x, y, z] = BLOCK_LIGHTING.lanternOffset;
  return (
    <>
      <ambientLight intensity={BLOCK.ambient} color={BLOCK_LIGHTING.ambientColor} />
      <group ref={carrier}>
        <pointLight
          position={[x, y, z]}
          color={BLOCK_LIGHTING.lantern.color}
          intensity={BLOCK_LIGHTING.lantern.intensity}
          distance={BLOCK_LIGHTING.lantern.distance}
          decay={BLOCK_LIGHTING.lantern.decay}
        />
      </group>
    </>
  );
}
