import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { visibleExitModel } from './visible-exit-model';
import { wallModel } from './scene-model';
import { EQUIPMENT_COLORS } from './facility-theme';
import { ExitOwnerLabel, exitOwnerLabel, type OwnerNames } from './ExitOwnerLabel';
export const exitPerspectivePlayerId = (view: PrivateView) =>
  view.spectating?.targetId ?? view.self?.playerId;
export function VisibleExits({
  view,
  ownerNames = {},
}: {
  view: PrivateView;
  ownerNames?: OwnerNames;
}) {
  const perspectivePlayerId = exitPerspectivePlayerId(view);
  return (
    <group>
      {visibleExitModel(view).map((exit) => {
        const model = wallModel(exit.wall);
        const position = model.position.map((n, i) => n + model.normal[i]! * 0.006) as [
          number,
          number,
          number,
        ];
        return (
          <group key={exit.exitId} position={position} rotation={model.rotation}>
            <ExitOwnerLabel text={exitOwnerLabel(exit.ownerId, perspectivePlayerId, ownerNames)} />
            <mesh>
              <planeGeometry args={[0.65, 0.95]} />
              <meshStandardMaterial color="#80928b" metalness={0.5} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0.002]}>
              <planeGeometry args={[0.48, 0.79]} />
              <meshStandardMaterial color="#183230" metalness={0.3} roughness={0.8} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.29, 0, 0.026]}>
                <boxGeometry args={[0.026, 0.94, 0.035]} />
                <meshStandardMaterial
                  color="#61756d"
                  emissive={
                    exit.ownerId === perspectivePlayerId
                      ? EQUIPMENT_COLORS.ownExitGlow
                      : EQUIPMENT_COLORS.otherExitGlow
                  }
                  emissiveIntensity={1.1}
                  roughness={0.5}
                  metalness={0.5}
                />
              </mesh>
            ))}
            <mesh position={[0.175, -0.04, 0.022]}>
              <boxGeometry args={[0.024, 0.15, 0.03]} />
              <meshStandardMaterial color="#b8c3b5" roughness={0.45} metalness={0.75} />
            </mesh>
            <mesh position={[0, 0.22, 0.012]}>
              <boxGeometry args={[0.14, 0.016, 0.01]} />
              <meshBasicMaterial
                color={
                  exit.ownerId === perspectivePlayerId
                    ? EQUIPMENT_COLORS.ownExit
                    : EQUIPMENT_COLORS.otherExit
                }
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
