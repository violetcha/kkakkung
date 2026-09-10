import { Canvas } from '@react-three/fiber';
import { useAppStore } from '../../room/store';
import type { ComponentProps } from 'react';
import { ScenePrimitives } from './primitives';

export function WorldCanvas({ scene }: { scene?: ComponentProps<typeof ScenePrimitives> } = {}) {
  const players = useAppStore((state) => state.players);
  const sessionId = useAppStore((state) => state.sessionId);
  if (scene)
    return (
      <Canvas camera={{ position: [0, 0.8, 2], fov: 60 }} aria-label="까꿍 미로">
        <color attach="background" args={['#141413']} />
        <ambientLight intensity={1.5} />
        <ScenePrimitives {...scene} />
      </Canvas>
    );
  return (
    <Canvas camera={{ position: [0, 36, 30], fov: 48 }} aria-label="연동 시험장 3D 화면">
      <color attach="background" args={['#07131f']} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[4, 8, 3]} intensity={2.5} />
      <gridHelper args={[32, 32, '#3e84a8', '#18384b']} />
      {players.map((player) => (
        <mesh key={player.playerId} position={[player.x, 0.5, player.z]}>
          <boxGeometry args={[0.75, 1, 0.75]} />
          <meshStandardMaterial color={player.playerId === sessionId ? '#5eead4' : '#f8bd6b'} />
        </mesh>
      ))}
    </Canvas>
  );
}
