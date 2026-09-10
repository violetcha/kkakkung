import type { PrivateView } from '@kkakkung/protocol/game-schema';
import type { FaceTextures } from './face-textures';
import { cellPosition, directionYaw } from './scene-model';

export function FaceAvatars({ view, faces }: { view: PrivateView; faces?: FaceTextures }) {
  if (view.self?.status !== 'ACTIVE') return null;
  return (
    <>
      {view.visibleEntities
        .filter((entity) => entity.kind === 'player' && entity.id !== view.self?.playerId)
        .map((entity) => {
          if (entity.kind !== 'player') return null;
          const texture = faces?.get(entity.id) ?? null;
          const ally = entity.role === view.self?.role;
          return (
            <group
              key={entity.id}
              position={cellPosition(entity.cell)}
              rotation={[0, directionYaw(entity.dir), 0]}
            >
              <mesh position={[0, 0.72, -0.241]} rotation={[0, Math.PI, 0]}>
                <planeGeometry args={[0.42, 0.42]} />
                <meshBasicMaterial
                  key={texture?.uuid ?? 'safe'}
                  map={texture}
                  color={texture ? '#ffffff' : '#777770'}
                  toneMapped={false}
                />
              </mesh>
              {ally && (
                <mesh position={[0, 1.03, 0]}>
                  <sphereGeometry args={[0.04, 8, 6]} />
                  <meshBasicMaterial color="#b8ebca" />
                </mesh>
              )}
            </group>
          );
        })}
    </>
  );
}
