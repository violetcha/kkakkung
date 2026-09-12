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
              <boxGeometry args={[0.18, 0.2, 0.07]} />
              <meshStandardMaterial color="#73817a" metalness={0.45} roughness={0.58} />
            </mesh>
            <mesh position={[0, 0.01, 0.075]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.015, 12]} />
              <meshStandardMaterial color="#132325" metalness={0.3} roughness={0.5} />
            </mesh>
            <mesh position={[0, -0.065, 0.074]}>
              <boxGeometry args={[item.state === 'ARMED' ? 0.07 : 0.02, 0.012, 0.01]} />
              <meshBasicMaterial
                color={item.state === 'ARMED' ? '#8bdbbc' : '#d4a95d'}
                toneMapped={false}
              />
            </mesh>
          </group>
        ) : (
          <group key={item.id} position={[item.cell.x, 0.017, item.cell.y]}>
            <mesh>
              <boxGeometry args={[0.36, 0.032, 0.36]} />
              <meshStandardMaterial color="#57625d" metalness={0.6} roughness={0.65} />
            </mesh>
            <mesh position={[0, 0.019, 0]}>
              <boxGeometry args={[0.24, 0.005, 0.24]} />
              <meshStandardMaterial color="#182726" roughness={0.85} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.145, item.state === 'ARMED' ? 0.035 : 0.021, 0]}>
                <boxGeometry args={[0.026, item.state === 'ARMED' ? 0.035 : 0.008, 0.28]} />
                <meshStandardMaterial
                  color={item.state === 'ARMED' ? '#d4a95d' : '#859289'}
                  roughness={0.64}
                  metalness={0.3}
                />
              </mesh>
            ))}
          </group>
        ),
      )}
    </group>
  );
}
