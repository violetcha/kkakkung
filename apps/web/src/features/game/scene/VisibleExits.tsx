import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { visibleExitModel } from './visible-exit-model';
import { wallModel } from './scene-model';
import { ExitOwnerLabel, exitOwnerLabel, type OwnerNames } from './ExitOwnerLabel';
export function VisibleExits({
  view,
  ownerNames = {},
}: {
  view: PrivateView;
  ownerNames?: OwnerNames;
}) {
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
            <ExitOwnerLabel text={exitOwnerLabel(exit.ownerId, view.self?.playerId, ownerNames)} />
            <mesh>
              <planeGeometry args={[0.65, 0.95]} />
              <meshBasicMaterial
                color={exit.ownerId === view.self?.playerId ? '#b8ebca' : '#dfbb79'}
              />
            </mesh>
            <mesh position={[0, 0, 0.002]}>
              <planeGeometry args={[0.48, 0.79]} />
              <meshBasicMaterial color="#161615" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
