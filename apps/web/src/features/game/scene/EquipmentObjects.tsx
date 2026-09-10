import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { visibleEquipment } from '../equipment/equipment-presenter';
import { wallModel } from './scene-model';
export function EquipmentObjects({ view }: { view: PrivateView }) {
  return (
    <group>
      {visibleEquipment(view).map((item) =>
        item.kind === 'sensor' ? (
          <group key={item.id} {...wallModel(item.wall)}>
            <mesh position={[0, 0, 0.035]}>
              <boxGeometry args={[0.14, 0.14, 0.06]} />
              <meshStandardMaterial color={item.state === 'ARMED' ? '#dfbb79' : '#777777'} />
            </mesh>
          </group>
        ) : (
          <mesh key={item.id} position={[item.cell.x, 0.025, item.cell.y]}>
            <boxGeometry args={[0.32, 0.05, 0.32]} />
            <meshStandardMaterial color={item.state === 'ARMED' ? '#dfbb79' : '#777777'} />
          </mesh>
        ),
      )}
    </group>
  );
}
