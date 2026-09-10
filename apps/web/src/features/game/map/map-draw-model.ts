import type { PrivateView } from '@kkakkung/protocol/game-schema';
export function mapDrawModel(view: PrivateView | null) {
  if (!view || view.self?.status !== 'ACTIVE') return null;
  return {
    terrain: view.knownTerrain,
    self: { cell: view.self.cell, dir: view.self.dir },
    exits: view.self.role === 'runner' ? view.knownActiveExits : [],
  };
}
