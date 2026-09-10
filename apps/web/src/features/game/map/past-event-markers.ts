import type { PrivateEvent } from '@kkakkung/protocol/game-messages';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
export type HunterMarker = Extract<PrivateEvent, { type: 'HUNTER_MARKER' }>['payload'];
export function pastEventMarkers(
  view: PrivateView | null,
  markers: readonly HunterMarker[],
  tick: number,
) {
  if (view?.self?.status !== 'ACTIVE' || view.self.role !== 'tagger') return [];
  return markers.filter((marker) => marker.showAtTick <= tick && tick < marker.expiresTick);
}
