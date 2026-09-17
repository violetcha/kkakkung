import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import { EQUIPMENT_COLORS } from './facility-theme';
import { BLOCK_LIGHTING } from './block-theme';
import { HAND, type HeldToolKind } from './held-tool';

/**
 * S15P21C204-268. The player's own hand in the lower right of the view: a lantern (the block
 * theme's light source, so the glow has a visible origin) and the selected tool. The group
 * follows the camera every frame, so it lives in camera space and never in the maze grid. The
 * HUD's hotbar decides `tool`; the caller defaults it from the player's stock.
 */
export function HeldTool({ tool }: { tool: HeldToolKind | null }) {
  const hand = useRef<Group>(null);
  useFrame(({ camera }) => {
    if (!hand.current) return;
    hand.current.position.copy(camera.position);
    hand.current.quaternion.copy(camera.quaternion);
  });
  const [ox, oy, oz] = HAND.offset;
  const [rx, ry, rz] = HAND.rotation;
  const [lx, ly, lz] = HAND.lanternOffset;
  return (
    <group ref={hand}>
      <group position={[ox, oy, oz]} rotation={[rx, ry, rz]}>
        {/* Lantern: dark frame, glowing core. The frame is a block, like everything else. */}
        <group position={[lx, ly, lz]}>
          <mesh>
            <boxGeometry args={[0.05, 0.07, 0.05]} />
            <meshStandardMaterial color="#1c1a16" roughness={0.9} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.032, 0.046, 0.032]} />
            <meshBasicMaterial color={BLOCK_LIGHTING.lantern.color} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.048, 0]}>
            <boxGeometry args={[0.012, 0.03, 0.012]} />
            <meshStandardMaterial color="#1c1a16" roughness={0.9} />
          </mesh>
        </group>
        {tool === 'sensor' && (
          <group position={[-0.05, -0.02, 0]}>
            <mesh>
              <boxGeometry args={[0.09, 0.1, 0.05]} />
              <meshStandardMaterial
                color={EQUIPMENT_COLORS.sensorHousing}
                metalness={0.45}
                roughness={0.58}
              />
            </mesh>
            <mesh position={[0, 0.005, 0.028]}>
              <boxGeometry args={[0.05, 0.05, 0.012]} />
              <meshStandardMaterial color={EQUIPMENT_COLORS.sensorLens} roughness={0.5} />
            </mesh>
            <mesh position={[0, -0.036, 0.027]}>
              <boxGeometry args={[0.03, 0.008, 0.008]} />
              <meshBasicMaterial color={EQUIPMENT_COLORS.idle} toneMapped={false} />
            </mesh>
          </group>
        )}
        {tool === 'trap' && (
          <group position={[-0.05, -0.03, 0]} rotation={[0.5, 0, 0]}>
            <mesh>
              <boxGeometry args={[0.11, 0.012, 0.11]} />
              <meshStandardMaterial
                color={EQUIPMENT_COLORS.trapPlate}
                metalness={0.6}
                roughness={0.65}
              />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.044, 0.01, 0]}>
                <boxGeometry args={[0.01, 0.012, 0.09]} />
                <meshStandardMaterial color={EQUIPMENT_COLORS.trapJawIdle} roughness={0.64} />
              </mesh>
            ))}
            <mesh position={[0, 0.03, 0]}>
              <boxGeometry args={[0.012, 0.05, 0.012]} />
              <meshStandardMaterial color={EQUIPMENT_COLORS.trapPost} metalness={0.5} />
            </mesh>
            <mesh position={[0, 0.062, 0]}>
              <boxGeometry args={[0.016, 0.016, 0.016]} />
              <meshBasicMaterial color={EQUIPMENT_COLORS.idle} toneMapped={false} />
            </mesh>
          </group>
        )}
        {tool === 'map' && (
          <group position={[-0.06, -0.02, 0]} rotation={[-0.35, 0.2, 0]}>
            {/* A torn map piece: bone-coloured sheet with a few dark ink strokes for corridors. */}
            <mesh>
              <boxGeometry args={[0.13, 0.1, 0.004]} />
              <meshStandardMaterial color="#c9bea6" roughness={0.95} />
            </mesh>
            {[
              [-0.03, 0.02, 0.06, 0.008],
              [0.02, -0.01, 0.008, 0.05],
              [0.035, 0.025, 0.04, 0.008],
              [-0.04, -0.03, 0.03, 0.008],
            ].map(([x, y, w, h], index) => (
              <mesh key={index} position={[x!, y!, 0.003]}>
                <boxGeometry args={[w!, h!, 0.002]} />
                <meshStandardMaterial color="#3a2f24" roughness={1} />
              </mesh>
            ))}
          </group>
        )}
      </group>
    </group>
  );
}
