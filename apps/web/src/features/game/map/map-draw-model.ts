import type { Cell, PrivateView } from '@kkakkung/protocol/game-schema';
import { sampleActor } from '../scene/action-interpolation';
const sameCell = (left: Cell, right: Cell) => left.x === right.x && left.y === right.y;

export function mapDrawModel(
  view: PrivateView | null,
  tick: number | null = null,
  operatorExit: Cell | null = null,
) {
  if (!view) return null;
  const perspective = view.self?.status === 'ACTIVE' ? view.self : view.spectating;
  if (!perspective) return null;
  const exits =
    view.self?.status === 'ACTIVE' && view.self.role === 'tagger' ? [] : view.knownActiveExits;
  return {
    terrain: view.knownTerrain,
    self: sampleActor(perspective, tick),
    // The operator exit gets its own symbol in a demo. Do not render it again as a normal exit.
    exits: operatorExit ? exits.filter((exit) => !sameCell(exit.approach, operatorExit)) : exits,
    operatorExit,
  };
}
