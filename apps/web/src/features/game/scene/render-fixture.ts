import type {
  Cell,
  Dir,
  PrivateView,
  VisibleEntity,
  WallFace,
} from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';

export const RENDER_SCENES = ['복도', '코너', '출구·장비', '상대 5명'] as const;
export type RenderScene = (typeof RENDER_SCENES)[number];
/** 자기 동작. 회전 중 벽 관통·잘림과 전진 중 셀 등장을 이동 시점 0–20으로 검수한다. */
export const SELF_MOTIONS = ['still', 'turn', 'move'] as const;
export type SelfMotion = (typeof SELF_MOTIONS)[number];
/** Development-only invented recipient views. No master map or production layout is imported. */
export function renderFixture(
  scene: RenderScene,
  facing: Dir = 0,
  selfMotion: SelfMotion = 'still',
): PrivateView {
  const cells: Cell[] = [
    { x: 0, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: -2 },
  ];
  let walls: WallFace[] = [
    ...[0, -1, -2].flatMap((y) => [
      { x: -1, y, side: 1 as const },
      { x: 1, y, side: 3 as const },
    ]),
    { x: 0, y: -3, side: 2 },
  ];
  const players: VisibleEntity[] =
    scene === '출구·장비'
      ? []
      : [
          {
            id: 'other',
            kind: 'player',
            cell: { x: 0, y: -2 },
            dir: 2,
            role: 'runner',
            action: {
              kind: 'move',
              from: { x: 0, y: -2, dir: 2 },
              to: { x: 0, y: -1, dir: 2 },
              startTick: 0,
              endTick: 20,
            },
          },
        ];
  if (scene === '코너') {
    cells.push({ x: 1, y: -2 });
    walls = walls.filter((wall) => wall.x !== 1 || wall.y !== -2);
    walls.push({ x: 1, y: -3, side: 2 }, { x: 2, y: -2, side: 3 });
  }
  if (scene === '상대 5명') {
    cells.push(...[-1, 1].flatMap((x) => [0, -1, -2].map((y) => ({ x, y }))));
    walls = [
      ...[0, -1, -2].flatMap((y) => [
        { x: -2, y, side: 1 as const },
        { x: 2, y, side: 3 as const },
      ]),
      ...[-1, 0, 1].map((x) => ({ x, y: -3, side: 2 as const })),
    ];
    players.push(
      ...[
        [-1, -1],
        [1, -1],
        [-1, -2],
        [1, -2],
      ].map(([x, y], index) => ({
        id: `other-${index}`,
        kind: 'player' as const,
        cell: { x: x!, y: y! },
        dir: 2 as const,
        action: null,
      })),
    );
  }
  const exitWall = walls.at(-1)!;
  const base = viewFixture();
  if (base.self?.status !== 'ACTIVE') throw Error('active fixture required');
  const rotate = (cell: Cell): Cell => {
    let { x, y } = cell;
    for (let i = 0; i < facing; i++) [x, y] = [-y, x];
    return { x: 16 + x, y: 16 + y };
  };
  const rotateWall = (wall: WallFace): WallFace => ({
    ...rotate(wall),
    side: ((wall.side + facing) % 4) as Dir,
  });
  const origin = { ...rotate({ x: 0, y: 0 }), dir: facing };
  const selfAction =
    selfMotion === 'turn'
      ? { kind: 'turn' as const, from: origin, to: { ...origin, dir: ((facing + 1) % 4) as Dir } }
      : selfMotion === 'move'
        ? { kind: 'move' as const, from: origin, to: { ...rotate({ x: 0, y: -1 }), dir: facing } }
        : null;
  return {
    ...base,
    self: {
      ...base.self,
      cell: rotate({ x: 0, y: 0 }),
      dir: facing,
      action: selfAction && { ...selfAction, startTick: 0, endTick: 20 },
    },
    visibleCells: cells.map(rotate),
    visibleWallFaces: walls.map(rotateWall),
    knownTerrain: cells.map((cell) => ({ ...rotate(cell), kind: 'floor' })),
    knownActiveExits:
      scene === '출구·장비'
        ? [
            {
              exitId: 'exit',
              ownerId: 'self',
              wall: rotateWall(exitWall),
              approach: rotate({ x: 0, y: -2 }),
            },
          ]
        : [],
    visibleEntities:
      scene === '출구·장비'
        ? [
            {
              id: 'sensor',
              kind: 'sensor',
              cell: rotate({ x: 0, y: -1 }),
              wall: rotateWall({ x: 1, y: -1, side: 3 }),
              state: 'ARMED',
            },
            { id: 'trap', kind: 'trap', cell: rotate({ x: 0, y: -1 }), state: 'UNARMED' },
          ]
        : players.map((player) =>
            player.kind !== 'player'
              ? player
              : {
                  ...player,
                  cell: rotate(player.cell),
                  dir: ((player.dir + facing) % 4) as Dir,
                  action: player.action
                    ? {
                        ...player.action,
                        from: {
                          ...rotate(player.action.from),
                          dir: ((player.action.from.dir + facing) % 4) as Dir,
                        },
                        to: {
                          ...rotate(player.action.to),
                          dir: ((player.action.to.dir + facing) % 4) as Dir,
                        },
                      }
                    : null,
                },
          ),
  };
}
