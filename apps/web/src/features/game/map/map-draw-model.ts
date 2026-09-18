import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { sampleActor } from '../scene/action-interpolation';
export function mapDrawModel(view: PrivateView | null, tick: number | null = null) {
  if (!view) return null;
  const perspective = view.self?.status === 'ACTIVE' ? view.self : view.spectating;
  if (!perspective) return null;
  return {
    terrain: view.knownTerrain,
    self: sampleActor(perspective, tick),
    exits:
      view.self?.status === 'ACTIVE' && view.self.role === 'tagger' ? [] : view.knownActiveExits,
  };
}
