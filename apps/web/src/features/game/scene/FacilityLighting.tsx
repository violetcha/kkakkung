import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Object3D } from 'three';
import type { ActiveSelf } from '@kkakkung/protocol/game-schema';
import { sampleSelf } from './action-interpolation';
import type { QualityPreset } from './quality-presets';
import { FACILITY } from './facility-theme';

export function FacilityLighting({
  self,
  quality,
  renderTick,
}: {
  self: ActiveSelf;
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
    const sample = sampleSelf(self, renderTick());
    light.current?.position.set(sample.x, 0, sample.z);
    light.current?.rotation.set(0, sample.yaw, 0);
  });
  return (
    <>
      <ambientLight intensity={FACILITY.ambient} color="#99b6bc" />
      <hemisphereLight args={['#b2c4c5', '#1c292c', 0.48]} />
      <group ref={light}>
        <primitive object={target} />
        <spotLight
          position={[0, 0.98, 0.05]}
          target={target}
          color="#e5dcbb"
          intensity={8}
          distance={3.4}
          angle={0.75}
          penumbra={0.8}
          decay={2}
        />
        {quality === 'medium' && (
          <pointLight
            position={[0, 1.05, 0.25]}
            color="#8bb8bd"
            intensity={0.5}
            distance={1.8}
            decay={2}
          />
        )}
      </group>
    </>
  );
}
