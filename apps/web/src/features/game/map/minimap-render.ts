// S15P21C204-277 (W10). 미니맵 그리기. 벽·바닥·안 가 본 칸을 서로 다른 모양으로 그려
// 미니맵만 보고도 구분되게 한다. 캔버스 호출만 하고 판정은 map-draw-model 이 한다.
import type { Cell, PrivateView, Role } from '@kkakkung/protocol/game-schema';
import { ROLE_COLORS } from '../scene/role-colors';
import { mapDrawModel } from './map-draw-model';
import { pastEventMarkers, type HunterMarker } from './past-event-markers';
import {
  edgeArrow,
  HUNTER_MARKER_STYLES,
  hunterMarkerPhase,
  rgba,
  type MarkerShape,
} from './hunter-marker-style';

/** 미니맵이 담는 칸 수. 맵 템플릿과 같은 한 변이다. */
export const MINIMAP_CELLS = 32;
/**
 * S15P21C204-295. 경기 화면의 근접 창. 전체 32칸을 168px 에 넣으면 칸이 5px 라 내 위치와 방향이
 * 안 보였다. 내 주변 홀수 칸만 확대해 그리면 칸이 15px 안팎이 되고 내 표식이 항상 가운데다.
 */
export const MINIMAP_WINDOW_CELLS = 11;

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
  operatorExit: '#f4c96b',
  marker: '#d8aa61',
  /** 창 모드(docs/design/ui-system.md): 잉크 바탕, 뼛빛 벽·점, 흰 그라데이션 시야. 역할 색과 겹치지 않는다. */
  coneCenter: 'rgba(255, 255, 255, 0.6)',
  coneFade: 'rgba(255, 255, 255, 0)',
  coneEdge: 'rgba(230, 225, 211, 0.85)',
  me: '#f2ede0',
  /** 창 모드의 바닥은 어두운 잉크, 벽은 뼛빛 선. 내 출구는 나트륨, 남의 출구는 흐린 뼛빛. */
  windowBackground: '#0b0b0a',
  windowFloor: '#2a2823',
  windowWall: '#e6e1d3',
  windowExitMine: '#d9b25a',
  windowExitOther: '#9d9889',
});
/** 창 모드 시야 부채꼴: 서버 시야(3.5셀) 안쪽으로 셀 단위 반지름과 각도(라디안). */
export const MINIMAP_CONE = Object.freeze({ radiusCells: 3.2, spreadRad: Math.PI / 2 });

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

/**
 * S15P21C204-352. 축척이 흐르는 동안에는 칸을 정수 픽셀에 맞추지 않는다. 칸 수가 소수로
 * 지나가는데 정수로 반올림하면 지도가 프레임마다 한 픽셀씩 튄다. 머무는 두 축척(창·전체)은
 * 지금처럼 정수라 도트가 흐려지지 않는다.
 */
export function minimapLayout(
  size: number,
  cells = MINIMAP_CELLS,
  options: Readonly<{ fractional?: boolean }> = {},
): MinimapLayout {
  const unit = options.fractional
    ? Math.max(0.5, size / cells)
    : Math.max(1, Math.floor(size / cells));
  const span = unit * cells;
  return {
    cells,
    unit,
    span,
    offset: options.fractional
      ? Math.max(0, (size - span) / 2)
      : Math.max(0, Math.floor((size - span) / 2)),
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
  | 'createRadialGradient'
  | 'rect'
  | 'clip'
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

/**
 * 창 모드의 지도 원점(소수). 내 위치가 정확히 창 가운데에 고정되고 지도가 그 아래에서 연속으로
 * 흐른다. 칸 단위로 반올림하면 한 칸 지날 때마다 지도가 턱턱 뛰어 보인다.
 */
export function windowOrigin(self: Readonly<{ x: number; z: number }>, cells: number) {
  // 홀수 칸의 한가운데. 정수 칸 수에서는 (cells - 1) / 2 가 Math.floor(cells / 2) 와 같고,
  // 축척이 흐르는 동안에는 소수 칸 수에서도 내가 정확히 가운데에 남는다 (352).
  const half = (cells - 1) / 2;
  return { x: self.x - half, y: self.z - half };
}

/**
 * S15P21C204-352. 전환 도중의 창. `zoom` 0 은 내 주변 창, 1 은 전체 지도다. 칸 수는 둘 사이를
 * 지나가고, 창의 기준점은 내 위치 중심에서 지도 원점으로 옮겨 간다. 그래서 줌아웃이 끝나면
 * 전체 지도와 정확히 같은 자리에 선다.
 */
export function zoomedWindow(
  self: Readonly<{ x: number; z: number }>,
  windowCells: number,
  zoom: number,
  fullCells = MINIMAP_CELLS,
): Readonly<{ cells: number; origin: Readonly<{ x: number; y: number }>; zoom: number }> {
  const t = zoom < 0 ? 0 : zoom > 1 ? 1 : zoom;
  const cells = windowCells + (fullCells - windowCells) * t;
  const centered = windowOrigin(self, cells);
  return { cells, origin: { x: centered.x * (1 - t) + 0, y: centered.y * (1 - t) + 0 }, zoom: t };
}

/** 창 모드 지형: 창 좌표로 옮기고 창 밖(한 칸 여유)은 버린다. 좌표는 소수일 수 있다. */
export function windowTerrain(
  terrain: PrivateView['knownTerrain'],
  origin: Readonly<{ x: number; y: number }>,
  cells: number,
): MinimapTerrain {
  const keep = (x: number, y: number) => x > -1.5 && y > -1.5 && x < cells + 0.5 && y < cells + 0.5;
  const floors: { x: number; y: number }[] = [];
  const walls: { x: number; y: number; side: number }[] = [];
  for (const item of terrain) {
    const x = item.x - origin.x;
    const y = item.y - origin.y;
    if (!keep(x, y)) continue;
    if (item.kind === 'floor') floors.push({ x, y });
    else walls.push({ x, y, side: item.side });
  }
  return { floors, walls, unknown: 0 };
}

export type MinimapInput = {
  view: PrivateView | null;
  size: number;
  tick?: number;
  markers?: readonly HunterMarker[];
  /** Supplied only by the operator demo room; ordinary rooms leave this absent. */
  operatorExit?: Cell | null;
  cells?: number;
  /** 홀수 칸 수를 주면 내 주변만 확대해 그린다(창 모드). 없으면 전체 지도. */
  window?: number;
  /** S15P21C204-352. 창 모드에서 0 은 내 주변, 1 은 전체 지도. 그 사이는 전환 중이다. */
  zoom?: number;
};

/**
 * S15P21C204-327. 같은 그림을 두 번 그리지 않기 위한 열쇠. `drawMinimap` 이 읽는 것만 담는다.
 *
 * 미니맵은 서버 패치마다, 즉 초당 20번 다시 그려지고 있었다. 그중 대부분은 **글자 그대로 같은
 * 그림**이다 — 서 있는 동안에는 보간된 내 위치도 그대로이기 때문이다. 다만 `tick` 자체를
 * 의존에서 뺄 수는 없다. 이동 중에는 화살표가 tick 마다 실제로 움직이고, 술래의 과거 사건
 * 표식도 tick 으로 나타났다 사라진다. 그래서 tick 이 아니라 **그려질 결과**를 비교한다.
 *
 * 누적 지형은 자라기만 하므로 개수로 갈음한다. 좌표는 캔버스 픽셀보다 잘게 반올림해, 눈에
 * 보이지 않는 차이로 다시 그리지 않으면서 보이는 차이는 놓치지 않는다.
 */
export function minimapDrawKey(input: MinimapInput): string {
  const tick = input.tick ?? 0;
  const model = mapDrawModel(input.view, tick, input.operatorExit ?? null);
  if (!model) return `empty:${input.size}:${input.cells ?? ''}:${input.window ?? ''}`;
  return JSON.stringify([
    input.size,
    input.cells ?? null,
    input.window ?? null,
    // 축척이 흐르는 동안에는 프레임마다 다시 그린다. 머물러 있으면 값이 그대로라 그리지 않는다.
    Math.round((input.zoom ?? 0) * 1000),
    Math.round(model.self.x * 256),
    Math.round(model.self.z * 256),
    Math.round(model.self.yaw * 256),
    model.terrain.length,
    model.exits.map((exit) => exit.exitId),
    model.operatorExit,
    input.view?.self?.status === 'ACTIVE' ? input.view.self.role : null,
    // 표식은 물결·흐려짐으로 틱마다 모양이 바뀐다. 보이는 동안만 4분의 1 틱 단위로 다시 그린다.
    pastEventMarkers(input.view, input.markers ?? [], tick).map(
      (marker) => `${marker.markerId}:${Math.floor((tick - marker.showAtTick) * 4)}`,
    ),
  ]);
}

function drawMarkerShape(
  ctx: MinimapContext,
  shape: MarkerShape,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (shape === 'triangle') {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.9, y + size * 0.7);
    ctx.lineTo(x - size * 0.9, y + size * 0.7);
    ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(x - size * 0.75, y - size * 0.75, size * 1.5, size * 1.5);
  } else {
    ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
  }
  ctx.fill();
}

export function drawMinimap(ctx: MinimapContext, input: MinimapInput): MinimapLayout {
  const tick = input.tick ?? 0;
  const model = mapDrawModel(input.view, tick, input.operatorExit ?? null);
  const windowed = input.window !== undefined && model !== null;
  const zoomed = windowed ? zoomedWindow(model!.self, input.window!, input.zoom ?? 0) : null;
  const layout = minimapLayout(
    input.size,
    zoomed ? zoomed.cells : (input.cells ?? MINIMAP_CELLS),
    // 전환 도중에만 소수 칸을 허용한다. 창과 전체 지도에 머무는 동안은 정수 픽셀 그대로다.
    { fractional: zoomed !== null && zoomed.zoom > 0 && zoomed.zoom < 1 },
  );
  const { unit, offset, span } = layout;
  const origin = zoomed ? zoomed.origin : { x: 0, y: 0 };
  ctx.fillStyle = windowed ? MINIMAP_COLORS.windowBackground : MINIMAP_COLORS.background;
  ctx.fillRect(0, 0, input.size, input.size);

  // 안 가 본 칸: 전체 지도에서는 옅은 격자만. 바닥을 칠하지 않아 "가 본 곳"과 한눈에 갈린다.
  // 창 모드는 격자 없이 어두운 바탕만 둬서 가 본 바닥의 사각형이 그대로 드러난다.
  // 전체 지도로 줌아웃하면 안 가 본 칸의 격자를 켠다. 창에서는 격자가 없어야 가 본 바닥이
  // 드러나므로, 전환이 절반을 넘어선 뒤부터 그린다 (352).
  if (!windowed || (zoomed !== null && zoomed.zoom > 0.5)) {
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
  }

  if (!model) return layout;
  // 창 모드에서는 지도 좌표를 창 좌표로 옮긴 뒤 창 밖은 버린다(minimapTerrain 의 범위 검사).
  const terrain = windowed
    ? windowTerrain(model.terrain, origin, layout.cells)
    : minimapTerrain(model.terrain, layout.cells);
  const local = (x: number, y: number) => ({ x: x - origin.x, y: y - origin.y });
  const inside = (x: number, y: number) =>
    windowed
      ? x > -1.5 && y > -1.5 && x < layout.cells + 0.5 && y < layout.cells + 0.5
      : x >= 0 && y >= 0 && x < layout.cells && y < layout.cells;
  if (windowed) {
    // 지도가 소수 좌표로 흐르므로 창 사각형 밖으로 삐져나오는 칸은 잘라 낸다.
    ctx.save();
    ctx.beginPath();
    ctx.rect(offset, offset, span, span);
    ctx.clip();
  }

  ctx.fillStyle = windowed ? MINIMAP_COLORS.windowFloor : MINIMAP_COLORS.floor;
  for (const floor of terrain.floors)
    ctx.fillRect(offset + floor.x * unit, offset + floor.y * unit, unit, unit);

  if (windowed) {
    // 벽은 칸 경계에 얇은 선. 두꺼운 띠보다 사각형 윤곽이 또렷하다.
    ctx.strokeStyle = MINIMAP_COLORS.windowWall;
    ctx.lineWidth = Math.max(2, Math.round(unit / 7));
    ctx.beginPath();
    for (const wall of terrain.walls) {
      const left = offset + wall.x * unit;
      const top = offset + wall.y * unit;
      if (wall.side === 0) {
        ctx.moveTo(left, top);
        ctx.lineTo(left + unit, top);
      } else if (wall.side === 2) {
        ctx.moveTo(left, top + unit);
        ctx.lineTo(left + unit, top + unit);
      } else if (wall.side === 1) {
        ctx.moveTo(left + unit, top);
        ctx.lineTo(left + unit, top + unit);
      } else {
        ctx.moveTo(left, top);
        ctx.lineTo(left, top + unit);
      }
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = MINIMAP_COLORS.wall;
    for (const wall of terrain.walls) {
      const rect = wallBandRect(wall, layout);
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  const perspectiveId = input.view?.spectating?.targetId ?? input.view?.self?.playerId;
  ctx.lineWidth = Math.max(1, Math.round(unit / 8));
  ctx.font = `11px Galmuri11, monospace`;
  for (const [index, exit] of model.exits.entries()) {
    const at = local(exit.approach.x, exit.approach.y);
    if (!inside(at.x, at.y)) continue;
    const mine = exit.ownerId === perspectiveId;
    ctx.strokeStyle = windowed
      ? mine
        ? MINIMAP_COLORS.windowExitMine
        : MINIMAP_COLORS.windowExitOther
      : mine
        ? MINIMAP_COLORS.exitMine
        : MINIMAP_COLORS.exitOther;
    if (windowed) {
      // 출구는 문이 난 벽면에 두꺼운 색 띠로. 접근 칸 안쪽 모서리에 번호를 작게 둔다.
      const door = local(exit.wall.x, exit.wall.y);
      const left = offset + door.x * unit;
      const top = offset + door.y * unit;
      const thick = Math.max(5, Math.round(unit * 0.5));
      ctx.fillStyle = mine ? MINIMAP_COLORS.windowExitMine : MINIMAP_COLORS.windowExitOther;
      const side = exit.wall.side;
      const cx = side === 1 ? left + unit : side === 3 ? left : left + unit / 2;
      const cy = side === 2 ? top + unit : side === 0 ? top : top + unit / 2;
      if (side === 0 || side === 2) ctx.fillRect(left + 1, cy - thick / 2, unit - 2, thick);
      else ctx.fillRect(cx - thick / 2, top + 1, thick, unit - 2);
      // 번호는 문 바깥쪽(접근 칸에서 문 너머 방향) 중앙에 밝게. wall 은 이웃 칸 쪽 면으로도 올 수
      // 있어(예: 북쪽 문이 위 칸의 남쪽 면) side 만으로는 방향이 뒤집힌다. 접근 칸 → 벽 칸 벡터를 쓴다.
      const size = Math.max(8, Math.round(unit * 0.55));
      const away = unit * 0.55;
      let dx = Math.sign(exit.wall.x - exit.approach.x);
      let dy = Math.sign(exit.wall.y - exit.approach.y);
      if (dx === 0 && dy === 0) {
        dx = side === 1 ? 1 : side === 3 ? -1 : 0;
        dy = side === 2 ? 1 : side === 0 ? -1 : 0;
      }
      const nx = cx + dx * away;
      const ny = cy + dy * away;
      ctx.fillStyle = MINIMAP_COLORS.me;
      ctx.font = `700 ${size}px sans-serif`;
      ctx.fillText(String(index + 1), nx - size * 0.3, ny + size * 0.36);
    } else {
      ctx.strokeRect(offset + at.x * unit, offset + at.y * unit, unit, unit);
      ctx.fillStyle = MINIMAP_COLORS.wall;
      ctx.fillText(String(index + 1), offset + (at.x + 1) * unit, offset + at.y * unit);
    }
  }

  // S15P21C204-314. 창 모드(295)에서는 다른 표시처럼 내 주변 좌표로 옮기고, 창 밖이면 그리지 않는다.
  const operatorAt = model.operatorExit ? local(model.operatorExit.x, model.operatorExit.y) : null;
  if (operatorAt && inside(operatorAt.x, operatorAt.y)) {
    const centerX = offset + (operatorAt.x + 0.5) * unit;
    const centerY = offset + (operatorAt.y + 0.5) * unit;
    const radius = Math.max(3, unit * 0.38);
    // A diamond-within-circle is intentionally different from the square normal-exit marker.
    ctx.strokeStyle = MINIMAP_COLORS.operatorExit;
    ctx.lineWidth = Math.max(1, Math.round(unit / 6));
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - radius);
    ctx.lineTo(centerX + radius, centerY);
    ctx.lineTo(centerX, centerY + radius);
    ctx.lineTo(centerX - radius, centerY);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = MINIMAP_COLORS.operatorExit;
    ctx.fillText('O', centerX - 3, centerY + 4);
  }

  const role: Role =
    input.view?.self?.status === 'ACTIVE' ? input.view.self.role : ('runner' as Role);
  const me = local(model.self.x, model.self.z);
  ctx.save();
  ctx.translate(offset + (me.x + 0.5) * unit, offset + (me.y + 0.5) * unit);
  ctx.rotate(-model.self.yaw);
  if (windowed) {
    // 내 위치는 흰 점, 내 시선은 앞으로 펼쳐지는 흰 부채꼴. 위(-y)가 정면이고 rotate 가 방향을 준다.
    const radius = unit * MINIMAP_CONE.radiusCells;
    const half = MINIMAP_CONE.spreadRad / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    glow.addColorStop(0, MINIMAP_COLORS.coneCenter);
    glow.addColorStop(1, MINIMAP_COLORS.coneFade);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(3, unit * 0.28), 0, Math.PI * 2);
    ctx.fillStyle = MINIMAP_COLORS.me;
    ctx.fill();
  } else {
    ctx.fillStyle = roleMarkColor(role);
    ctx.beginPath();
    ctx.moveTo(0, -unit / 2);
    ctx.lineTo(-unit / 3, unit / 3);
    ctx.lineTo(unit / 3, unit / 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // S15P21C204-386. 종류별 모양·색, 퍼지는 물결, 끝의 흐려짐. 창 밖 사건은 가장자리 화살표.
  const center = {
    x: offset + (me.x + 0.5) * unit,
    y: offset + (me.y + 0.5) * unit,
  };
  for (const marker of pastEventMarkers(input.view, input.markers ?? [], tick)) {
    const style = HUNTER_MARKER_STYLES[marker.kind];
    const phase = hunterMarkerPhase(marker, tick);
    const at = local(marker.point.x, marker.point.y);
    const x = offset + (at.x + 0.5) * unit;
    const y = offset + (at.y + 0.5) * unit;
    if (inside(at.x, at.y)) {
      if (style.ripple) {
        ctx.lineWidth = Math.max(1.5, unit / 6);
        for (const ring of phase.rings) {
          ctx.strokeStyle = rgba(style.rgb, ring.alpha);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(3, unit * ring.radiusCells), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      drawMarkerShape(
        ctx,
        style.shape,
        x,
        y,
        Math.max(3, unit * 0.42),
        rgba(style.rgb, phase.alpha),
      );
    } else if (windowed) {
      const pad = Math.max(6, unit * 0.6);
      const edge = edgeArrow(center, { x, y }, { min: offset + pad, max: offset + span - pad });
      if (!edge) continue;
      const size = Math.max(6, unit * 0.7);
      ctx.save();
      ctx.translate(edge.x, edge.y);
      ctx.rotate(edge.angle);
      ctx.fillStyle = rgba(style.rgb, phase.alpha * phase.pulse);
      ctx.beginPath();
      ctx.moveTo(size * 0.6, 0);
      ctx.lineTo(-size * 0.5, -size * 0.5);
      ctx.lineTo(-size * 0.2, 0);
      ctx.lineTo(-size * 0.5, size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(style.rgb, phase.rings[0]!.alpha);
      ctx.lineWidth = Math.max(1.5, unit / 6);
      ctx.beginPath();
      ctx.arc(0, 0, size * (0.6 + phase.rings[0]!.radiusCells / 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (windowed) ctx.restore();
  if (windowed) {
    // 북쪽 표시. 지도는 회전하지 않으므로 위가 항상 북쪽이다.
    ctx.fillStyle = MINIMAP_COLORS.coneEdge;
    ctx.font = `600 ${Math.max(10, Math.round(unit * 0.7))}px sans-serif`;
    ctx.fillText('N', offset + span / 2 - unit * 0.22, offset + unit * 0.8);
  }
  return layout;
}
