import { Canvas } from '@react-three/fiber';
import { useAppStore } from '../../room/store';

export function WorldCanvas() {
  const players = useAppStore((state) => state.players);
  const sessionId = useAppStore((state) => state.sessionId);
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
