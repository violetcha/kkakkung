import type { EquipmentKind, InstallationView } from '../core-types.js';
import type { Cell, Dir, WallFace } from '../types.js';

/** Ticks a tagger must stand still for one installation, and the arming delay after it. */
export type InstallationTiming = Readonly<{ installationTicks: number; armTicks: number }>;

/**
 * Server-internal installation in progress. The public InstallationView carries
 * the ids and ticks; the target pose lives only here, so the client never
 * learns the wall face before the device exists.
 */
export type PendingInstallation = InstallationView &
  Readonly<{
    ownerId: string;
    /** Equipment id the completed device will get. */
    equipmentId: string;
    kind: EquipmentKind;
    /** Trap floor cell, or the sensor's approach cell. Also the anchor pose. */
    cell: Cell;
    dir: Dir;
    /** Sensor wall face pointing back at the approach cell; null for a trap. */
    wall: WallFace | null;
  }>;

export type PendingInstallations = ReadonlyMap<string, PendingInstallation>;

/** Public projection of one installation in progress. */
export function installationViewOf(pending: PendingInstallation): InstallationView {
  return Object.freeze({
    installationId: pending.installationId,
    kind: pending.kind,
    startTick: pending.startTick,
    endTick: pending.endTick,
    armedTick: pending.armedTick,
  });
}
