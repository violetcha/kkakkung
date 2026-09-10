import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { wallKey } from './scene-model';
import { visibilityMask } from './visibility-mask';
export function visibleExitModel(view: PrivateView) {
  if (view.self?.status !== 'ACTIVE' || view.self.role !== 'runner') return [];
  const walls = new Set(visibilityMask(view).walls.map(wallKey));
  return view.knownActiveExits.filter((exit) => walls.has(wallKey(exit.wall)));
}
