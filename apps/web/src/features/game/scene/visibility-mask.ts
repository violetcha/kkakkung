import type { PrivateView } from '@kkakkung/protocol/game-schema';
export function visibilityMask(view: PrivateView) {
  const perspective =
    view.self?.status === 'ACTIVE'
      ? { playerId: view.self.playerId, cell: view.self.cell }
      : view.spectating
        ? { playerId: view.spectating.targetId, cell: view.spectating.cell }
        : null;
  if (!perspective) return { cells: [], walls: [], players: [] };
  const near = (cell: { x: number; y: number }) =>
    Math.hypot(cell.x - perspective.cell.x, cell.y - perspective.cell.y) <= 3;
  return {
    cells: view.visibleCells.filter(near),
    walls: view.visibleWallFaces.filter(near),
    players: view.visibleEntities
      .filter((e) => e.kind === 'player' && e.id !== perspective.playerId && near(e.cell))
      .filter((e) => e.kind === 'player'),
  };
}
