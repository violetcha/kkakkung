import { isWalkable } from '../map/validate-template.js';
import type { Topology } from '../types.js';

export type Point = Readonly<{ x: number; y: number }>;

const EPS = 1e-9;

/**
 * Grid DDA from `from` to `to` (continuous coordinates, cell size 1). Returns
 * true when every cell the segment passes through, excluding the starting cell
 * and the destination cell, is a passage. When the segment crosses a grid vertex
 * exactly, both axis-adjacent cells are checked so a diagonal gap between two
 * walls never leaks visibility.
 */
export function segmentClear(topology: Topology, from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let cx = Math.floor(from.x);
  let cy = Math.floor(from.y);
  const endX = Math.floor(to.x);
  const endY = Math.floor(to.y);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);
  let tMaxX =
    stepX === 0 ? Number.POSITIVE_INFINITY : (stepX > 0 ? cx + 1 - from.x : from.x - cx) * tDeltaX;
  let tMaxY =
    stepY === 0 ? Number.POSITIVE_INFINITY : (stepY > 0 ? cy + 1 - from.y : from.y - cy) * tDeltaY;
  let guard = 0;
  while ((cx !== endX || cy !== endY) && guard < 256) {
    guard += 1;
    if (Math.abs(tMaxX - tMaxY) < EPS) {
      // Exact vertex crossing: both single-axis neighbors must be open.
      if (!isWalkable(topology, { x: cx + stepX, y: cy })) return false;
      if (!isWalkable(topology, { x: cx, y: cy + stepY })) return false;
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (cx === endX && cy === endY) break;
    if (!isWalkable(topology, { x: cx, y: cy })) return false;
  }
  return true;
}
