import type { ActiveSelf, EquipmentKind } from '@kkakkung/protocol/game-schema';

/** What the first-person hand shows: a tagger's selected device or a runner's map piece. */
export type HeldToolKind = EquipmentKind | 'map';

/**
 * S15P21C204-268. Until the HUD passes its own selection, the hand shows the first device the
 * tagger still has (sensor before trap, matching the hotbar order 1·2) and a map piece for a
 * runner. A tagger with nothing left holds only the lantern. Null from the caller means "hide".
 */
export function defaultHeldTool(self: ActiveSelf): HeldToolKind | null {
  if (self.role === 'runner') return 'map';
  if (self.equipment.sensor > 0) return 'sensor';
  if (self.equipment.trap > 0) return 'trap';
  return null;
}

/** Placement of the hand in camera space: lower right, close enough to sit inside the fog start. */
export const HAND = Object.freeze({
  offset: [0.26, -0.2, -0.46] as const,
  /** Slight inward yaw and a tilt so the tool's top face catches the lantern. */
  rotation: [-0.25, -0.45, 0.08] as const,
  lanternOffset: [0.09, 0.05, 0.02] as const,
});
