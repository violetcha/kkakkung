import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Object3D } from 'three';
import type { Action, Cell, Dir } from '@kkakkung/protocol/game-schema';
import { sampleActor } from './action-interpolation';
import type { QualityPreset } from './quality-presets';
import { FACILITY, LIGHTING } from './facility-theme';

export function FacilityLighting({
  self,
  quality,
  renderTick,
}: {
  self: { cell: Cell; dir: Dir; action?: Action | null };
  quality: QualityPreset;
  renderTick(): number | null;
}) {
  const light = useRef<Group>(null);
  const target = useMemo(() => {
    const object = new Object3D();
    object.position.set(0, 0.35, -2);
    return object;
  }, []);
  useFrame(() => {
    const sample = sampleActor(self, renderTick());
    light.current?.position.set(sample.x, 0, sample.z);
    light.current?.rotation.set(0, sample.yaw, 0);
  });
  return (
    <>
      <ambientLight intensity={FACILITY.ambient} color={LIGHTING.ambientColor} />
      <hemisphereLight
        args={[LIGHTING.hemisphere.sky, LIGHTING.hemisphere.ground, LIGHTING.hemisphere.intensity]}
      />
      <group ref={light}>
        <primitive object={target} />
        <spotLight
          position={[0, 0.98, 0.05]}
          target={target}
          color={LIGHTING.spot.color}
          intensity={LIGHTING.spot.intensity}
          distance={LIGHTING.spot.distance}
          angle={LIGHTING.spot.angle}
          penumbra={LIGHTING.spot.penumbra}
          decay={LIGHTING.spot.decay}
        />
        {quality === 'medium' && (
          <pointLight
            position={[0, 1.05, 0.25]}
            color={LIGHTING.fill.color}
            intensity={LIGHTING.fill.intensity}
            distance={LIGHTING.fill.distance}
            decay={LIGHTING.fill.decay}
          />
        )}
      </group>
    </>
  );
}
