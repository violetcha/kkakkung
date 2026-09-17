import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { visibleEquipment } from '../equipment/equipment-presenter';
import { wallModel } from './scene-model';
import { EQUIPMENT_COLORS } from './facility-theme';
import { TRAP_MODEL, trapJawHeight } from './equipment-model';

export function EquipmentObjects({ view }: { view: PrivateView }) {
  const { plate, inner, jaw, post, lamp } = TRAP_MODEL;
  return (
    <group>
      {visibleEquipment(view).map((item) =>
        item.kind === 'sensor' ? (
          <group key={item.id} {...wallModel(item.wall)}>
            <mesh position={[0, 0, 0.035]}>
              <boxGeometry args={[0.18, 0.2, 0.07]} />
              <meshStandardMaterial
                color={EQUIPMENT_COLORS.sensorHousing}
                metalness={0.45}
                roughness={0.58}
              />
            </mesh>
            {/* S15P21C204-268. Block forms only: the lens is a square plate, the post a square bar. */}
            <mesh position={[0, 0.01, 0.075]}>
              <boxGeometry args={[0.1, 0.1, 0.015]} />
              <meshStandardMaterial
                color={EQUIPMENT_COLORS.sensorLens}
                metalness={0.3}
                roughness={0.5}
              />
            </mesh>
            <mesh position={[0, -0.065, 0.074]}>
              <boxGeometry args={[item.state === 'ARMED' ? 0.07 : 0.02, 0.012, 0.01]} />
              <meshBasicMaterial
                color={item.state === 'ARMED' ? EQUIPMENT_COLORS.armed : EQUIPMENT_COLORS.idle}
                toneMapped={false}
              />
            </mesh>
          </group>
        ) : (
          <group key={item.id} position={[item.cell.x, plate.height / 2, item.cell.y]}>
            <mesh>
              <boxGeometry args={[plate.width, plate.height, plate.width]} />
              <meshStandardMaterial
                color={EQUIPMENT_COLORS.trapPlate}
                metalness={0.6}
                roughness={0.65}
              />
            </mesh>
            <mesh position={[0, plate.height / 2 + inner.height / 2, 0]}>
              <boxGeometry args={[inner.width, inner.height, inner.width]} />
              <meshStandardMaterial color={EQUIPMENT_COLORS.trapInner} roughness={0.85} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh
                key={side}
                position={[side * jaw.offset, plate.height / 2 + trapJawHeight(item.state) / 2, 0]}
              >
                <boxGeometry args={[jaw.width, trapJawHeight(item.state), jaw.depth]} />
                <meshStandardMaterial
                  color={
                    item.state === 'ARMED'
                      ? EQUIPMENT_COLORS.trapJawArmed
                      : EQUIPMENT_COLORS.trapJawIdle
                  }
                  roughness={0.64}
                  metalness={0.3}
                />
              </mesh>
            ))}
            {/* 인접 셀에서도 보이도록 바닥판 위에 세운 지지대와 표시등. 상태 색은 감지기와 같다. */}
            <mesh position={[0, plate.height / 2 + post.height / 2, 0]}>
              <boxGeometry args={[post.radius * 2, post.height, post.radius * 2]} />
              <meshStandardMaterial
                color={EQUIPMENT_COLORS.trapPost}
                metalness={0.5}
                roughness={0.55}
              />
            </mesh>
            <mesh position={[0, plate.height / 2 + post.height + lamp.size / 2, 0]}>
              <boxGeometry args={[lamp.size, lamp.size, lamp.size]} />
              <meshBasicMaterial
                color={item.state === 'ARMED' ? EQUIPMENT_COLORS.armed : EQUIPMENT_COLORS.idle}
                toneMapped={false}
              />
            </mesh>
          </group>
        ),
      )}
    </group>
  );
}
