import type { VisibleSurfaces } from '../core-types.js';
import {
  DIR_VECTORS,
  compareCells,
  compareWallFaces,
  isInside,
  isWalkable,
} from '../map/validate-template.js';
import type { PlayerRecord } from '../state.js';
import type { Cell, Dir, Topology, WallFace } from '../types.js';
import { segmentClear, type Point } from './raycast.js';

/**
 * Horizontal field of view is 80 degrees: 40 degrees to each side of the heading.
 *
 * S15P21C204-302 measured maze-v1 and left this alone on purpose. In a one-cell corridor the side
 * walls, not the cone, decide what is visible: 80, 90, 100 and 110 degrees all yield the same mean
 * of 2.63 visible cells per heading, and only a 120 degree fisheye moves it (+8.2%). Widening the
 * cone here would also force the renderer's camera (view-geometry.test) for no gain.
 */
export const FOV_HALF_DEGREES = 40;
/**
 * Samples farther than this (in cells) from the camera are never visible: five cells ahead.
 *
 * S15P21C204-302 raised this from 3.5 when maze-v1 became the default. The corridor maze shows a
 * quarter of what the open grid did (2.41 vs 9.70 mean visible cells per heading), and at 3.5 the
 * junction ahead was outside sight on 24% of headings, so a runner committed to a corridor blind.
 * At 5.0 that is 9%, for +15% visible cells; past 5.0 the curve flattens (6.5 is only +20%).
 */
export const VIEW_RANGE = 5.0;
/**
 * Candidate cells are collected from this square around the camera before the cone and the rays
 * narrow them, so it must cover VIEW_RANGE or the range is silently truncated: at range 5.5 a
 * radius of 4 still produced the range-4.5 result. Keep this at or above ceil(VIEW_RANGE).
 */
const CANDIDATE_RADIUS = 5;
const FACE_OFFSET = 0.02;
const COS_HALF_FOV = Math.cos((FOV_HALF_DEGREES * Math.PI) / 180);

export type Camera = Readonly<{
  x: number;
  y: number;
  heading: Readonly<{ x: number; y: number }>;
}>;

function headingOf(dir: Dir): Readonly<{ x: number; y: number }> {
  return { x: DIR_VECTORS[dir].dx, y: DIR_VECTORS[dir].dy };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Server virtual camera: cell center while idle, interpolated along the running
 * move, or the shortest 90 degree sweep during a turn. Progress is
 * (tick - startTick) / (endTick - startTick), clamped to [0, 1].
 */
export function cameraFor(player: PlayerRecord, tick: number): Camera {
  const action = player.action;
  if (!action) {
    return { x: player.cell.x + 0.5, y: player.cell.y + 0.5, heading: headingOf(player.dir) };
  }
  const span = action.endTick - action.startTick;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (tick - action.startTick) / span));
  if (action.kind === 'move') {
    return {
      x: lerp(action.from.x + 0.5, action.to.x + 0.5, t),
      y: lerp(action.from.y + 0.5, action.to.y + 0.5, t),
      heading: headingOf(action.from.dir),
    };
  }
  const from = headingOf(action.from.dir);
  const to = headingOf(action.to.dir);
  const angleFrom = Math.atan2(from.y, from.x);
  let delta = Math.atan2(to.y, to.x) - angleFrom;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const angle = angleFrom + delta * t;
  return {
    x: action.from.x + 0.5,
    y: action.from.y + 0.5,
    heading: { x: Math.cos(angle), y: Math.sin(angle) },
  };
}

function withinCone(camera: Camera, target: Point): boolean {
  const dx = target.x - camera.x;
  const dy = target.y - camera.y;
  const distance = Math.hypot(dx, dy);
  if (distance > VIEW_RANGE) return false;
  if (distance < 1e-6) return true;
  const cos = (dx * camera.heading.x + dy * camera.heading.y) / distance;
  return cos >= COS_HALF_FOV - 1e-9;
}

function cellSamples(cell: Cell): Point[] {
  return [
    { x: cell.x + 0.5, y: cell.y + 0.5 },
    { x: cell.x + 0.25, y: cell.y + 0.25 },
    { x: cell.x + 0.75, y: cell.y + 0.25 },
    { x: cell.x + 0.25, y: cell.y + 0.75 },
    { x: cell.x + 0.75, y: cell.y + 0.75 },
  ];
}

/** Face samples lie on the wall face nudged into the approach cell: center and both edges. */
function faceSamples(face: WallFace): Point[] {
  const v = DIR_VECTORS[face.side];
  // Face plane offset from the wall cell center toward the approach cell.
  const cx = face.x + 0.5 + v.dx * (0.5 + FACE_OFFSET);
  const cy = face.y + 0.5 + v.dy * (0.5 + FACE_OFFSET);
  // Tangent along the face.
  const tx = v.dy;
  const ty = v.dx;
  return [
    { x: cx, y: cy },
    { x: cx + tx * 0.3, y: cy + ty * 0.3 },
    { x: cx - tx * 0.3, y: cy - ty * 0.3 },
  ];
}

/** The camera must be on the approach side of the face plane to see that face. */
function facesCamera(face: WallFace, camera: Camera): boolean {
  switch (face.side) {
    case 0:
      return camera.y < face.y;
    case 1:
      return camera.x > face.x + 1;
    case 2:
      return camera.y > face.y + 1;
    default:
      return camera.x < face.x;
  }
}

/**
 * Visible passage cells and wall faces from a camera. A cell or face is visible
 * when at least one sample is inside the cone and range and the grid ray to it is
 * unobstructed. Only the first wall along a ray is exposed; faces behind it and
 * the back faces of a wall stay hidden.
 */
export function computeVisibility(topology: Topology, camera: Camera): VisibleSurfaces {
  const origin: Point = { x: camera.x, y: camera.y };
  const baseX = Math.floor(camera.x);
  const baseY = Math.floor(camera.y);
  const cells: Cell[] = [];
  const faces: WallFace[] = [];
  for (let y = baseY - CANDIDATE_RADIUS; y <= baseY + CANDIDATE_RADIUS; y += 1) {
    for (let x = baseX - CANDIDATE_RADIUS; x <= baseX + CANDIDATE_RADIUS; x += 1) {
      const cell = { x, y };
      if (!isInside(topology, cell)) continue;
      if (isWalkable(topology, cell)) {
        if (x === baseX && y === baseY) {
          cells.push(cell);
          continue;
        }
        if (
          cellSamples(cell).some((s) => withinCone(camera, s) && segmentClear(topology, origin, s))
        ) {
          cells.push(cell);
        }
        continue;
      }
      for (const side of [0, 1, 2, 3] as const) {
        const face: WallFace = { x, y, side };
        const v = DIR_VECTORS[side];
        const approach = { x: x + v.dx, y: y + v.dy };
        if (!isWalkable(topology, approach) || !facesCamera(face, camera)) continue;
        if (
          faceSamples(face).some((s) => withinCone(camera, s) && segmentClear(topology, origin, s))
        ) {
          faces.push(face);
        }
      }
    }
  }
  cells.sort(compareCells);
  faces.sort(compareWallFaces);
  return { visibleCells: cells, visibleWallFaces: faces };
}

export function visibilityOf(
  topology: Topology,
  player: PlayerRecord,
  tick: number,
): VisibleSurfaces {
  return computeVisibility(topology, cameraFor(player, tick));
}
