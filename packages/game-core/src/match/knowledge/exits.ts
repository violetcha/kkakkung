import type { VisibleSurfaces } from '../core-types.js';
import type { KnownExit, Role } from '../types.js';
import { activeExitAtFace, toKnownExit, type ExitRegistry } from '../exits/registry.js';
import type { KnowledgeRecord } from '../state.js';

/**
 * Exit discovery (KN-03): an ACTIVE runner records an exitId only when the
 * exact wall face of an active exit is among the currently visible faces.
 * Seeing the approach cell or another face of the same wall does not count.
 * Taggers never discover exits. Returns the same record when nothing changed.
 */
export function discoverExits(
  record: KnowledgeRecord,
  role: Role,
  surfaces: VisibleSurfaces,
  registry: ExitRegistry,
): KnowledgeRecord {
  if (role !== 'runner') return record;
  let discovered: Set<string> | null = null;
  for (const face of surfaces.visibleWallFaces) {
    const exit = activeExitAtFace(registry, face);
    if (!exit || record.discoveredExits.has(exit.exitId) || discovered?.has(exit.exitId)) continue;
    discovered ??= new Set(record.discoveredExits);
    discovered.add(exit.exitId);
  }
  if (!discovered) return record;
  return { ...record, discoveredExits: discovered, mapVersion: record.mapVersion + 1 };
}

/**
 * Public active exits for a player: the intersection of discovered ids and the
 * currently active registry, without poseKind. Taggers always get an empty list
 * so exit existence and position never leak to them.
 */
export function knownActiveExits(
  record: KnowledgeRecord,
  role: Role,
  registry: ExitRegistry,
): KnownExit[] {
  if (role !== 'runner') return [];
  const exits: KnownExit[] = [];
  for (const exitId of [...record.discoveredExits].sort()) {
    const exit = registry.get(exitId);
    if (exit && exit.active) exits.push(toKnownExit(exit));
  }
  return exits;
}
