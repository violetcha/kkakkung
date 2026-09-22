import { Canvas, useFrame } from '@react-three/fiber';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PointLight, MeshBasicMaterial } from 'three';
import type { Cell, WallFace } from '@kkakkung/protocol/game-schema';
import { ScenePrimitives } from '../game/scene/primitives';

// A decorative set, not a match map. No private terrain or session is needed on the home screen.
const cells: Cell[] = [];
for (let y = -80; y <= 3; y++) {
  for (let x = -1; x <= 1; x++) cells.push({ x, y });
  if (y % 9 === -5 || y % 9 === -6) for (const x of [-4, -3, -2, 2, 3, 4]) cells.push({ x, y });
}
const occupied = new Set(cells.map(({ x, y }) => `${x}:${y}`));
const waitingCells = cells.filter(({ y }) => y >= -2);
const waitingWalls: WallFace[] = [
  ...waitingCells.flatMap(({ y }) => [
    { x: -2, y, side: 1 as const },
    { x: 2, y, side: 3 as const },
  ]),
  ...[-1, 0, 1].map((x) => ({ x, y: -3, side: 2 as const })),
].filter(
  (wall, index, all) =>
    all.findIndex(
      (other) => other.x === wall.x && other.y === wall.y && other.side === wall.side,
    ) === index,
);
const walls: WallFace[] = [];
for (const cell of cells) {
  for (const [dx, dy, side] of [
    [0, -1, 2],
    [1, 0, 3],
    [0, 1, 0],
    [-1, 0, 1],
  ] as const) {
    const x = cell.x + dx;
    const y = cell.y + dy;
    if (y >= -80 && !occupied.has(`${x}:${y}`)) walls.push({ x, y, side });
  }
}

function CorridorLight({ z, phase, still }: { z: number; phase: number; still: boolean }) {
  const light = useRef<PointLight>(null);
  const tube = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime + phase) % 13;
    // Occasional brownout, not a rapid full-screen strobe. Light and tube share the same dip.
    const intensity = still ? 1 : t > 9.1 && t < 9.65 ? 0.16 : t > 10.1 && t < 10.45 ? 0.45 : 1;
    if (light.current) light.current.intensity = intensity * 2.3;
    const glow = intensity * (z < -20 ? 0.35 : 1);
    tube.current?.color.setRGB(glow, glow * 0.92, glow * 0.68);
  });
  return (
    <group>
      {z >= -20 && (
        <pointLight
          ref={light}
          position={[0, 1.67, z]}
          color="#e8d9a0"
          intensity={2.3}
          distance={6}
          decay={1.7}
        />
      )}
      <mesh position={[0, 1.87, z]}>
        <boxGeometry args={[0.9, 0.035, 0.22]} />
        <meshStandardMaterial color="#4c4b3e" />
      </mesh>
      <mesh position={[0, 1.845, z]}>
        <boxGeometry args={[0.78, 0.01, 0.12]} />
        <meshBasicMaterial ref={tube} color="#fff1b8" toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * S15P21C204-295. 복도 끝의 문. 경기에서 도망자가 찾아야 하는 그 출구를 대기실 배경에 세워 둔다.
 * 장식이라 아무것도 열리지 않는다. 조명은 복도 등이 준다.
 */
function ExitDoor() {
  return (
    <group position={[0, 0, -2.42]} scale={0.85}>
      <mesh position={[0, 1.12, 0]}>
        <boxGeometry args={[1.24, 2.24, 0.12]} />
        <meshStandardMaterial color="#39423c" roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.06, 0.08]}>
        <boxGeometry args={[1, 2.04, 0.06]} />
        <meshStandardMaterial color="#0a0b09" roughness={0.95} />
      </mesh>
      {/* 손잡이 자리의 가느다란 빛 한 줄 */}
      <mesh position={[0.37, 1, 0.12]}>
        <boxGeometry args={[0.05, 0.34, 0.02]} />
        <meshBasicMaterial color="#8c836b" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Corridor({ still, door }: { still: boolean; door: boolean }) {
  useFrame(({ camera, clock }) => {
    const t = still ? 0 : clock.elapsedTime;
    if (door) {
      camera.position.set(0, 1.05, 1.7);
      camera.lookAt(0, 0.38, -2.4);
      camera.rotation.z = 0;
      return;
    }
    camera.position.set(-1.28 + Math.sin(t * 0.13) * 0.025, 0.88, 2.3);
    camera.lookAt(0.7 + Math.sin(t * 0.09) * 0.1, 0.94, -8);
    camera.rotation.z = -0.025;
  });
  return (
    <>
      <color attach="background" args={['#090a07']} />
      <ambientLight intensity={door ? 0.42 : 0.12} color="#adac88" />
      <group scale={[1, door ? 1.45 : 1, 1]}>
        <ScenePrimitives
          cells={door ? waitingCells : cells}
          walls={door ? waitingWalls : walls}
          players={[]}
          theme="facility"
          quality="medium"
          fixtures={false}
        />
      </group>
      <group position={[0, door ? 0.8 : 0, 0]}>
        {(door ? [-1] : Array.from({ length: 19 }, (_, index) => -index * 4)).map((z, index) => (
          <CorridorLight key={z} z={z} phase={index * 2.7} still={still} />
        ))}
      </group>
      {door && <ExitDoor />}
    </>
  );
}

class BackdropBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function LobbyBackdrop({ paused, door = false }: { paused: boolean; door?: boolean }) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    media.addEventListener('change', changed);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      media.removeEventListener('change', changed);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const still = paused || reduced;
  return (
    <div className="lobby-backdrop" aria-hidden="true">
      <BackdropBoundary>
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: 'low-power' }}
          frameloop={hidden || still ? 'demand' : 'always'}
          camera={{ position: [-0.45, 0.9, 2.3], fov: 58, near: 0.05, far: 100 }}
        >
          <Corridor still={still} door={door} />
        </Canvas>
      </BackdropBoundary>
    </div>
  );
}
