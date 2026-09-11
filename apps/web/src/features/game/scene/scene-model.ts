import type { Cell, Dir, WallFace } from '@kkakkung/protocol/game-schema';

export const CHARACTER = Object.freeze({ head: 0.48, body: 0.26, eyeHeight: 0.8 });
export const cellPosition = (cell: Cell, height = 0): [number, number, number] => [
  cell.x,
  height,
  cell.y,
];
export const directionYaw = (dir: Dir) => (-dir * Math.PI) / 2;
export function wallModel(wall: WallFace) {
  const offsets = [
    [0, -0.5],
    [0.5, 0],
    [0, 0.5],
    [-0.5, 0],
  ] as const;
  const [x, z] = offsets[wall.side];
  return {
    position: [wall.x + x, 0.6, wall.y + z] as [number, number, number],
    // WallFace.side points out of the wall cell; a plane's front is local +Z.
    rotation: [0, directionYaw(wall.side) + Math.PI, 0] as [number, number, number],
    normal: [x * 2, 0, z * 2] as [number, number, number],
  };
}
export const wallKey = (wall: WallFace) => `${wall.x}:${wall.y}:${wall.side}`;
