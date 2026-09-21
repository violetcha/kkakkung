import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MathUtils } from 'three';
import { ROLE_COLORS } from './role-colors';
import { grabHandReach, refreshGrabHandMotion, type GrabHandMotion } from './grab-hand';

const START = Object.freeze({
  position: [0.34, -0.38, -0.22] as const,
  rotation: [-0.5, -0.25, -0.15] as const,
});
const EXTENDED = Object.freeze({
  position: [0.06, -0.1, -0.72] as const,
  rotation: [-0.1, 0, 0] as const,
});

/** 술래 자신의 카메라 공간에서만 보이는 블록형 왼팔·주먹. 서버 판정에는 관여하지 않는다. */
export function GrabHand({ signal }: { signal?: number }) {
  const cameraSpace = useRef<Group>(null);
  const hand = useRef<Group>(null);
  const motion = useRef<GrabHandMotion | null>(null);

  useEffect(() => {
    if (!signal) return;
    motion.current = refreshGrabHandMotion(motion.current, performance.now());
  }, [signal]);

  useFrame(({ camera }) => {
    if (!cameraSpace.current || !hand.current) return;
    cameraSpace.current.position.copy(camera.position);
    cameraSpace.current.quaternion.copy(camera.quaternion);
    const reach = grabHandReach(motion.current, performance.now());
    hand.current.visible = reach > 0.001;
    hand.current.position.set(
      MathUtils.lerp(START.position[0], EXTENDED.position[0], reach),
      MathUtils.lerp(START.position[1], EXTENDED.position[1], reach),
      MathUtils.lerp(START.position[2], EXTENDED.position[2], reach),
    );
    hand.current.rotation.set(
      MathUtils.lerp(START.rotation[0], EXTENDED.rotation[0], reach),
      MathUtils.lerp(START.rotation[1], EXTENDED.rotation[1], reach),
      MathUtils.lerp(START.rotation[2], EXTENDED.rotation[2], reach),
    );
  });

  return (
    <group ref={cameraSpace}>
      <group ref={hand} visible={false}>
        <mesh position={[0, -0.04, 0.17]}>
          <boxGeometry args={[0.11, 0.11, 0.36]} />
          <meshStandardMaterial color={ROLE_COLORS.tagger.cloth} roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.02, -0.04]}>
          <boxGeometry args={[0.17, 0.13, 0.18]} />
          <meshStandardMaterial color={ROLE_COLORS.tagger.accent} roughness={0.9} />
        </mesh>
        {[-0.06, -0.02, 0.02, 0.06].map((x) => (
          <mesh key={x} position={[x, 0.07, -0.13]}>
            <boxGeometry args={[0.038, 0.05, 0.05]} />
            <meshStandardMaterial color={ROLE_COLORS.tagger.accent} roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
