import type { PrivateView } from '@kkakkung/protocol/game-schema';
export function visibilityMask(view: PrivateView) {
  const self = view.self;
  if (self?.status !== 'ACTIVE') return { cells: [], walls: [], players: [] };
  const near = (cell: { x: number; y: number }) =>
    Math.hypot(cell.x - self.cell.x, cell.y - self.cell.y) <= 3;
  return {
    cells: view.visibleCells.filter(near),
    walls: view.visibleWallFaces.filter(near),
    players: view.visibleEntities
      .filter((e) => e.kind === 'player' && e.id !== self.playerId && near(e.cell))
      .filter((e) => e.kind === 'player'),
  };
}
