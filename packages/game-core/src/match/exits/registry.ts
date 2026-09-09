import type { Cell, KnownExit, LayoutExit, PoseKind, Topology, WallFace } from '../types.js';
import { approachOf, isWalkable, sameCell, sameFace } from '../map/validate-template.js';

/**
 * Server-internal exit record. `poseKind` is only revealed to the owner when a
 * challenge starts; `active` flips to false once and never back.
 */
export type ExitRecord = Readonly<{
  exitId: string;
  ownerId: string;
  wall: WallFace;
  approach: Cell;
  poseKind: PoseKind;
  active: boolean;
}>;

/** Immutable registry keyed by exitId. */
export type ExitRegistry = ReadonlyMap<string, ExitRecord>;

export type ExitRegistryError = Readonly<{
  code:
    | 'EXIT_COUNT'
    | 'DUPLICATE_ID'
    | 'DUPLICATE_OWNER'
    | 'DUPLICATE_APPROACH'
    | 'DUPLICATE_WALL'
    | 'OUTER_WALL'
    | 'NOT_WALL'
    | 'APPROACH_BLOCKED'
    | 'APPROACH_MISMATCH'
    | 'UNKNOWN_OWNER'
    | 'POSE_KIND';
  detail: string;
}>;

export type ExitRegistryResult =
  | Readonly<{ ok: true; registry: ExitRegistry }>
  | Readonly<{ ok: false; error: ExitRegistryError }>;

const POSES: readonly PoseKind[] = ['left', 'right', 'y'];

/**
 * Builds the registry from the selected layout exits. Each runner owns exactly
 * one inner-wall exit with a distinct approach cell. poseKind comes from the
 * seeded layout selection and is fixed for the match; retries never redraw it.
 */
export function createExitRegistry(
  topology: Topology,
  exits: readonly LayoutExit[],
  runnerIds: readonly string[],
): ExitRegistryResult {
  const fail = (code: ExitRegistryError['code'], detail: string): ExitRegistryResult => ({
    ok: false,
    error: { code, detail },
  });
  if (exits.length !== runnerIds.length) {
    return fail('EXIT_COUNT', `${exits.length} exits for ${runnerIds.length} runners`);
  }
  const runners = new Set(runnerIds);
  const ids = new Set<string>();
  const owners = new Set<string>();
  const seenApproach: Cell[] = [];
  const seenWall: WallFace[] = [];
  const registry = new Map<string, ExitRecord>();
  for (const exit of exits) {
    if (ids.has(exit.exitId)) return fail('DUPLICATE_ID', exit.exitId);
    ids.add(exit.exitId);
    if (!runners.has(exit.ownerId)) return fail('UNKNOWN_OWNER', exit.ownerId);
    if (owners.has(exit.ownerId)) return fail('DUPLICATE_OWNER', exit.ownerId);
    owners.add(exit.ownerId);
    if (!POSES.includes(exit.poseKind)) return fail('POSE_KIND', String(exit.poseKind));
    const wall = exit.wall;
    const outer =
      wall.x <= 0 || wall.y <= 0 || wall.x >= topology.width - 1 || wall.y >= topology.height - 1;
    if (outer) return fail('OUTER_WALL', `${wall.x},${wall.y}`);
    if (isWalkable(topology, wall)) return fail('NOT_WALL', `${wall.x},${wall.y}`);
    const approach = approachOf(wall);
    if (!isWalkable(topology, approach))
      return fail('APPROACH_BLOCKED', `${approach.x},${approach.y}`);
    if (!sameCell(approach, exit.approach)) return fail('APPROACH_MISMATCH', exit.exitId);
    if (seenApproach.some((c) => sameCell(c, approach))) {
      return fail('DUPLICATE_APPROACH', `${approach.x},${approach.y}`);
    }
    if (seenWall.some((f) => sameFace(f, wall))) return fail('DUPLICATE_WALL', exit.exitId);
    seenApproach.push(approach);
    seenWall.push(wall);
    registry.set(
      exit.exitId,
      Object.freeze({
        exitId: exit.exitId,
        ownerId: exit.ownerId,
        wall: Object.freeze({ x: wall.x, y: wall.y, side: wall.side }),
        approach: Object.freeze({ x: approach.x, y: approach.y }),
        poseKind: exit.poseKind,
        active: true,
      }),
    );
  }
  return { ok: true, registry };
}

export type CloseExitResult = Readonly<{
  registry: ExitRegistry;
  /** Identifier of the exit that changed, or null when nothing changed (idempotent). */
  closedExitId: string | null;
}>;

/**
 * Deactivates the owner's exit atomically without removing or reassigning it.
 * Calling again for the same owner is a no-op and returns closedExitId null.
 */
export function closeExit(registry: ExitRegistry, ownerId: string): CloseExitResult {
  for (const [exitId, record] of registry) {
    if (record.ownerId !== ownerId) continue;
    if (!record.active) return { registry, closedExitId: null };
    const next = new Map(registry);
    next.set(exitId, Object.freeze({ ...record, active: false }));
    return { registry: next, closedExitId: exitId };
  }
  return { registry, closedExitId: null };
}

export function exitOfOwner(registry: ExitRegistry, ownerId: string): ExitRecord | null {
  for (const record of registry.values()) if (record.ownerId === ownerId) return record;
  return null;
}

export function activeExits(registry: ExitRegistry): readonly ExitRecord[] {
  return [...registry.values()].filter((record) => record.active);
}

/** Active exit whose wall face equals the observed face exactly, or null. */
export function activeExitAtFace(registry: ExitRegistry, face: WallFace): ExitRecord | null {
  for (const record of registry.values()) {
    if (record.active && sameFace(record.wall, face)) return record;
  }
  return null;
}

/** Public shape for runners: never includes poseKind or inactive exits. */
export function toKnownExit(record: ExitRecord): KnownExit {
  return {
    exitId: record.exitId,
    ownerId: record.ownerId,
    wall: record.wall,
    approach: record.approach,
  };
}
