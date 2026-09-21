import type { CommandCode, EquipmentKind, OwnedEquipment } from '../core-types.js';
import { DIR_VECTORS, isWalkable, sameCell, sameFace } from '../map/validate-template.js';
import type { MatchState, PlayerRecord } from '../state.js';
import type { Cell, Dir, Topology, WallFace } from '../types.js';
import { installationViewOf, type PendingInstallation } from './types.js';

export type InstallTarget = Readonly<{
  kind: EquipmentKind;
  /** Trap floor cell, or the sensor's approach cell (the installer's own cell). */
  cell: Cell;
  dir: Dir;
  /** Sensor wall face pointing back at the approach cell; null for a trap. */
  wall: WallFace | null;
}>;

export type InstallReservation = Readonly<{ state: MatchState; pending: PendingInstallation }>;

export type InstallPlan =
  | Readonly<{ status: 'allowed'; target: InstallTarget }>
  | Readonly<{ status: 'rejected'; code: CommandCode }>;

export type CompletedInstallation = Readonly<{
  pending: PendingInstallation;
  /** True when the device was created; false when the installer left the pose. */
  completed: boolean;
}>;

export type InstallationUpkeepResult = Readonly<{
  state: MatchState;
  finished: readonly CompletedInstallation[];
}>;

/** The wall cell directly in front of a pose, or null when it is not an inner wall. */
export function frontWallFace(topology: Topology, cell: Cell, dir: Dir): WallFace | null {
  const vector = DIR_VECTORS[dir];
  const wall = { x: cell.x + vector.dx, y: cell.y + vector.dy };
  const outer =
    wall.x <= 0 || wall.y <= 0 || wall.x >= topology.width - 1 || wall.y >= topology.height - 1;
  if (outer || isWalkable(topology, wall)) return null;
  // The face of the wall that touches the pose cell points back at it.
  return { x: wall.x, y: wall.y, side: ((dir + 2) % 4) as Dir };
}

/**
 * Every player's placement cell: no device may be installed on a start cell. S15P21C204-316
 * reuses it so the demo harness cannot place a participant on one either.
 */
export function isStartCell(state: MatchState, cell: Cell): boolean {
  return state.layout.players.some((placed) => sameCell(placed.cell, cell));
}

/**
 * Whether the cell already carries a device or a reservation. One cell holds at
 * most one device, whoever installed it, so the same wall face cannot be taken
 * twice either.
 */
export function isOccupied(state: MatchState, cell: Cell, wall: WallFace | null): boolean {
  for (const id of state.order) {
    const player = state.players.get(id)!;
    for (const owned of player.ownedEquipment) {
      if (sameCell(owned.cell, cell)) return true;
      if (wall && owned.kind === 'sensor' && sameFace(owned.wall, wall)) return true;
    }
  }
  for (const pending of state.installations.values()) {
    if (sameCell(pending.cell, cell)) return true;
    if (wall && pending.wall && sameFace(pending.wall, wall)) return true;
  }
  return false;
}

/**
 * Install eligibility (EQ-01). A standing, ACTIVE tagger with stock and no
 * other installation running may place a trap on its own passage cell or a
 * sensor on the inner wall it faces. Start cells, the outer wall, and cells
 * that already hold a device are refused. The exit registry is never read, so
 * a hidden exit changes neither the outcome nor the timing.
 */
export function planInstall(
  state: MatchState,
  actor: PlayerRecord,
  kind: EquipmentKind,
): InstallPlan {
  if (kind !== 'sensor' && kind !== 'trap') return { status: 'rejected', code: 'INVALID_COMMAND' };
  if (actor.role !== 'tagger') return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (actor.action !== null) return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (actor.installation !== null) return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (actor.equipment[kind] <= 0) return { status: 'rejected', code: 'NOT_ALLOWED' };
  const cell = actor.cell;
  if (!isWalkable(state.layout.topology, cell)) return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (isStartCell(state, cell)) return { status: 'rejected', code: 'NOT_ALLOWED' };
  const wall = kind === 'sensor' ? frontWallFace(state.layout.topology, cell, actor.dir) : null;
  if (kind === 'sensor' && !wall) return { status: 'rejected', code: 'NOT_ALLOWED' };
  if (isOccupied(state, cell, wall)) return { status: 'rejected', code: 'NOT_ALLOWED' };
  return {
    status: 'allowed',
    target: { kind, cell: { x: cell.x, y: cell.y }, dir: actor.dir, wall },
  };
}

/**
 * Reserves the installation without consuming stock: the device and the charge
 * are only spent when the 10 tick placement finishes.
 */
export function reserveInstall(
  state: MatchState,
  actor: PlayerRecord,
  target: InstallTarget,
  tick: number,
): InstallReservation {
  const seq = state.installationSeq + 1;
  const endTick = tick + state.tuning.installationTicks;
  const pending: PendingInstallation = Object.freeze({
    installationId: `ins-${seq}`,
    equipmentId: `eq-${seq}`,
    ownerId: actor.playerId,
    kind: target.kind,
    cell: Object.freeze({ x: target.cell.x, y: target.cell.y }),
    dir: target.dir,
    wall: target.wall
      ? Object.freeze({ x: target.wall.x, y: target.wall.y, side: target.wall.side })
      : null,
    startTick: tick,
    endTick,
    armedTick: endTick + state.tuning.armTicks,
  });
  const installations = new Map(state.installations);
  installations.set(pending.installationId, pending);
  const players = new Map(state.players);
  players.set(actor.playerId, { ...actor, installation: installationViewOf(pending) });
  return {
    state: { ...state, players, installations, installationSeq: seq },
    pending,
  };
}

/** Drops a reservation without touching stock. Repeated calls change nothing. */
export function dropInstall(state: MatchState, pending: PendingInstallation): MatchState {
  const installations = new Map(state.installations);
  const removed = installations.delete(pending.installationId);
  const owner = state.players.get(pending.ownerId);
  const players = new Map(state.players);
  let touched = false;
  if (owner && owner.installation?.installationId === pending.installationId) {
    players.set(pending.ownerId, { ...owner, installation: null });
    touched = true;
  }
  if (!removed && !touched) return state;
  return { ...state, players, installations };
}

/** Cancel authorization: only the owner's own reservation, only before it ends. */
export function verifyInstallCancel(
  state: MatchState,
  actorId: string,
  installationId: string,
):
  | Readonly<{ status: 'canceled'; pending: PendingInstallation }>
  | Readonly<{
      status: 'rejected';
      code: CommandCode;
    }> {
  const pending = state.installations.get(installationId);
  // A finished installation is no longer here: its device and charge stay spent.
  if (!pending) return { status: 'rejected', code: 'STALE_REQUEST' };
  if (pending.ownerId !== actorId) return { status: 'rejected', code: 'NOT_ALLOWED' };
  return { status: 'canceled', pending };
}

function deviceOf(pending: PendingInstallation): OwnedEquipment {
  const base = {
    equipmentId: pending.equipmentId,
    state: 'UNARMED' as const,
    armedTick: pending.armedTick,
  };
  return Object.freeze(
    pending.kind === 'sensor'
      ? { ...base, kind: 'sensor' as const, cell: pending.cell, wall: pending.wall! }
      : { ...base, kind: 'trap' as const, cell: pending.cell },
  );
}

/** The installer must still be the same ACTIVE, standing player on that pose. */
function stillPlacing(owner: PlayerRecord | undefined, pending: PendingInstallation): boolean {
  if (!owner || owner.status !== 'ACTIVE') return false;
  if (owner.action !== null) return false;
  return sameCell(owner.cell, pending.cell) && owner.dir === pending.dir;
}

/**
 * Per-tick installation upkeep (EQ-01). A reservation whose owner moved, turned
 * or ended is dropped with no charge spent. One that stood still to its end
 * tick consumes exactly one charge and creates the device as UNARMED, which
 * becomes ARMED 20 ticks later.
 */
export function advanceInstallations(state: MatchState, tick: number): InstallationUpkeepResult {
  let next = state;
  const finished: CompletedInstallation[] = [];
  for (const pending of state.installations.values()) {
    const owner = next.players.get(pending.ownerId);
    if (!stillPlacing(owner, pending)) {
      next = dropInstall(next, pending);
      finished.push({ pending, completed: false });
      continue;
    }
    if (pending.endTick > tick) continue;
    const players = new Map(next.players);
    players.set(pending.ownerId, {
      ...owner!,
      equipment: Object.freeze({
        ...owner!.equipment,
        [pending.kind]: owner!.equipment[pending.kind] - 1,
      }),
      ownedEquipment: Object.freeze([...owner!.ownedEquipment, deviceOf(pending)]),
      installation: null,
    });
    const installations = new Map(next.installations);
    installations.delete(pending.installationId);
    next = { ...next, players, installations };
    finished.push({ pending, completed: true });
  }
  return { state: armDueEquipment(next, tick), finished };
}

/**
 * Spends one ARMED device (EQ-02/EQ-04). ARMED to SPENT happens once: a device
 * that is UNARMED, already SPENT, or missing leaves the state untouched.
 */
export function spendEquipment(
  state: MatchState,
  ownerId: string,
  equipmentId: string,
): MatchState {
  const owner = state.players.get(ownerId);
  if (!owner) return state;
  const target = owner.ownedEquipment.find((e) => e.equipmentId === equipmentId);
  if (!target || target.state !== 'ARMED') return state;
  const players = new Map(state.players);
  players.set(ownerId, {
    ...owner,
    ownedEquipment: Object.freeze(
      owner.ownedEquipment.map((e) =>
        e.equipmentId === equipmentId ? Object.freeze({ ...e, state: 'SPENT' as const }) : e,
      ),
    ),
  });
  return { ...state, players };
}

/** Flips every UNARMED device whose arming tick has come; SPENT never returns. */
export function armDueEquipment(state: MatchState, tick: number): MatchState {
  let players: Map<string, PlayerRecord> | null = null;
  for (const id of state.order) {
    const player = state.players.get(id)!;
    if (!player.ownedEquipment.some((e) => e.state === 'UNARMED' && tick >= e.armedTick)) continue;
    players ??= new Map(state.players);
    players.set(id, {
      ...player,
      ownedEquipment: Object.freeze(
        player.ownedEquipment.map((e) =>
          e.state === 'UNARMED' && tick >= e.armedTick
            ? Object.freeze({ ...e, state: 'ARMED' as const })
            : e,
        ),
      ),
    });
  }
  return players ? { ...state, players } : state;
}
