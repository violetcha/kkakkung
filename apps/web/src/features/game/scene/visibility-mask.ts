import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { SERVER_VIEW_RANGE } from './block-theme';

/**
 * Drops what the perspective owner cannot see from what the server already sent. The radius is
 * the server's own view range (S15P21C204-289): a smaller one here hides cells the server calls
 * visible — at 3 the diagonal cell 3.16 away was never drawn — and a larger one draws nothing
 * extra, since the server never sends a cell beyond its range. `tests/contracts/view-geometry`
 * pins this to the core constant.
 */
export function visibilityMask(view: PrivateView) {
  const perspective =
    view.self?.status === 'ACTIVE'
      ? { playerId: view.self.playerId, cell: view.self.cell }
      : view.spectating
        ? { playerId: view.spectating.targetId, cell: view.spectating.cell }
        : null;
  if (!perspective) return { cells: [], walls: [], players: [] };
  const near = (cell: { x: number; y: number }) =>
    Math.hypot(cell.x - perspective.cell.x, cell.y - perspective.cell.y) <= SERVER_VIEW_RANGE;
  return {
    cells: view.visibleCells.filter(near),
    walls: view.visibleWallFaces.filter(near),
    players: view.visibleEntities
      .filter((e) => e.kind === 'player' && e.id !== perspective.playerId && near(e.cell))
      .filter((e) => e.kind === 'player'),
  };
}
