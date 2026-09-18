// S15P21C204-277 (W10). 미니맵 그리기. 벽·바닥·안 가 본 칸을 서로 다른 모양으로 그려
// 미니맵만 보고도 구분되게 한다. 캔버스 호출만 하고 판정은 map-draw-model 이 한다.
import type { PrivateView, Role } from '@kkakkung/protocol/game-schema';
import { ROLE_COLORS } from '../scene/role-colors';
import { mapDrawModel } from './map-draw-model';
import { pastEventMarkers, type HunterMarker } from './past-event-markers';

/** 미니맵이 담는 칸 수. 맵 템플릿과 같은 한 변이다. */
export const MINIMAP_CELLS = 32;

/**
 * 색은 styles.css 의 디자인 토큰과 같은 값이다. 캔버스는 CSS 변수를 읽지 못해 여기 적어 둔다.
 * 역할 색만은 3D 옷 색(role-colors.ts)을 그대로 가져와 화면마다 달라지지 않게 한다.
 */
export const MINIMAP_COLORS = Object.freeze({
  /** --color-bg. 안 가 본 칸의 바탕이다. */
  background: '#090706',
  /** --color-seam. 안 가 본 칸을 옅은 격자로만 알린다. */
  unknownGrid: '#3a2b22',
  /** --color-border. 가 본 바닥은 칸을 가득 채운다. 벽 띠보다 어두워 둘이 겹쳐 보이지 않는다. */
  floor: '#796651',
  /** --color-text. 벽은 칸 경계에 두꺼운 띠로 앉힌다. */
  wall: '#f4ead7',
  /** --color-success / --color-warning. */
  exitMine: '#8dcf9f',
  exitOther: '#d8aa61',
  marker: '#d8aa61',
});

export const roleMarkColor = (role: Role) =>
  role === 'tagger' ? ROLE_COLORS.tagger.cloth : ROLE_COLORS.runner.cloth;

export type MinimapLayout = Readonly<{
  cells: number;
  /** 칸 하나의 픽셀 크기. 항상 정수라 도트가 흐려지지 않는다. */
  unit: number;
  /** 그려지는 지도 한 변. */
  span: number;
  /** 남는 여백을 반씩 나눈 시작점. 정수다. */
  offset: number;
  /** 벽 띠 두께. 칸의 1/4 을 정수로 맞추되 보이는 최소 두께를 지킨다. */
  band: number;
  /** 격자를 몇 칸마다 그을지. 칸이 작으면 성기게 그어 그물처럼 보이지 않게 한다. */
  gridStep: number;
}>;

export function minimapLayout(size: number, cells = MINIMAP_CELLS): MinimapLayout {
  const unit = Math.max(1, Math.floor(size / cells));
  const span = unit * cells;
  return {
    cells,
    unit,
    span,
    offset: Math.max(0, Math.floor((size - span) / 2)),
    band: unit >= 4 ? Math.max(2, Math.round(unit / 4)) : 1,
    gridStep: unit >= 6 ? 1 : 4,
  };
}

export type MinimapTerrain = Readonly<{
  floors: readonly Readonly<{ x: number; y: number }>[];
  walls: readonly Readonly<{ x: number; y: number; side: number }>[];
  /** 아직 한 번도 못 본 칸 수. 옅은 격자만 그리는 자리다. */
  unknown: number;
}>;

/** 알려진 지형을 바닥과 벽으로 나눈다. 지도 밖 좌표는 버린다. */
export function minimapTerrain(
  terrain: PrivateView['knownTerrain'],
  cells = MINIMAP_CELLS,
): MinimapTerrain {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cells && y < cells;
  const floors: { x: number; y: number }[] = [];
  const walls: { x: number; y: number; side: number }[] = [];
  const seen = new Set<string>();
  for (const item of terrain) {
    if (!inside(item.x, item.y)) continue;
    seen.add(`${item.x},${item.y}`);
    if (item.kind === 'floor') floors.push({ x: item.x, y: item.y });
    else walls.push({ x: item.x, y: item.y, side: item.side });
  }
  return { floors, walls, unknown: cells * cells - seen.size };
}

/** 캔버스에서 실제로 쓰는 것만. 시험이 같은 모양의 기록기를 넘길 수 있게 좁혀 둔다. */
export type MinimapContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'fillRect'
  | 'strokeRect'
  | 'fillText'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'arc'
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
>;

/** 벽 한 면이 차지하는 사각형. 칸 경계에 띠로 앉는다. */
export function wallBandRect(
  wall: Readonly<{ x: number; y: number; side: number }>,
  layout: MinimapLayout,
) {
  const { unit, band, offset } = layout;
  const left = offset + wall.x * unit;
  const top = offset + wall.y * unit;
  if (wall.side === 0) return { x: left, y: top, width: unit, height: band };
  if (wall.side === 2) return { x: left, y: top + unit - band, width: unit, height: band };
  if (wall.side === 1) return { x: left + unit - band, y: top, width: band, height: unit };
  return { x: left, y: top, width: band, height: unit };
}

export function drawMinimap(
  ctx: MinimapContext,
  input: {
    view: PrivateView | null;
    size: number;
    tick?: number;
    markers?: readonly HunterMarker[];
    cells?: number;
  },
): MinimapLayout {
  const layout = minimapLayout(input.size, input.cells ?? MINIMAP_CELLS);
  const { unit, offset, span } = layout;
  const tick = input.tick ?? 0;
  ctx.fillStyle = MINIMAP_COLORS.background;
  ctx.fillRect(0, 0, input.size, input.size);

  // 안 가 본 칸: 옅은 격자만. 바닥을 칠하지 않아 "가 본 곳"과 한눈에 갈린다.
  ctx.strokeStyle = MINIMAP_COLORS.unknownGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= layout.cells; i += layout.gridStep) {
    const at = offset + i * unit + 0.5;
    ctx.moveTo(offset, at);
    ctx.lineTo(offset + span, at);
    ctx.moveTo(at, offset);
    ctx.lineTo(at, offset + span);
  }
  ctx.stroke();

  const model = mapDrawModel(input.view, tick);
  if (!model) return layout;
  const terrain = minimapTerrain(model.terrain, layout.cells);

  ctx.fillStyle = MINIMAP_COLORS.floor;
  for (const floor of terrain.floors)
    ctx.fillRect(offset + floor.x * unit, offset + floor.y * unit, unit, unit);

  ctx.fillStyle = MINIMAP_COLORS.wall;
  for (const wall of terrain.walls) {
    const rect = wallBandRect(wall, layout);
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  const perspectiveId = input.view?.spectating?.targetId ?? input.view?.self?.playerId;
  ctx.lineWidth = Math.max(1, Math.round(unit / 8));
  ctx.font = `11px Galmuri11, monospace`;
  for (const [index, exit] of model.exits.entries()) {
    ctx.strokeStyle =
      exit.ownerId === perspectiveId ? MINIMAP_COLORS.exitMine : MINIMAP_COLORS.exitOther;
    ctx.strokeRect(offset + exit.approach.x * unit, offset + exit.approach.y * unit, unit, unit);
    ctx.fillStyle = MINIMAP_COLORS.wall;
    ctx.fillText(
      String(index + 1),
      offset + (exit.approach.x + 1) * unit,
      offset + exit.approach.y * unit,
    );
  }

  const role: Role =
    input.view?.self?.status === 'ACTIVE' ? input.view.self.role : ('runner' as Role);
  ctx.save();
  ctx.translate(offset + (model.self.x + 0.5) * unit, offset + (model.self.z + 0.5) * unit);
  ctx.rotate(-model.self.yaw);
  ctx.fillStyle = roleMarkColor(role);
  ctx.beginPath();
  ctx.moveTo(0, -unit / 2);
  ctx.lineTo(-unit / 3, unit / 3);
  ctx.lineTo(unit / 3, unit / 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = MINIMAP_COLORS.marker;
  for (const marker of pastEventMarkers(input.view, input.markers ?? [], tick)) {
    ctx.beginPath();
    ctx.arc(
      offset + (marker.point.x + 0.5) * unit,
      offset + (marker.point.y + 0.5) * unit,
      Math.max(2, unit * 0.3),
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  return layout;
}
