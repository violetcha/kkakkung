import { PlayerState, SandboxState } from '@kkakkung/protocol/schema';
import type {
  ActiveSelf,
  EndedSelf,
  KnownExit,
  KnownTerrain,
  LoadingView,
  OwnedEquipment,
  VisibleEntity,
} from '@kkakkung/protocol/game-schema';
import type { WorldState } from '@kkakkung/game-core';
import type { CorePort } from './ports.js';
import type { PrivateViewBody } from './EventDispatcher.js';

/** Public sandbox only. The product room never uses this projection. */
export function projectSandbox(world: WorldState, target: SandboxState) {
  target.tick = world.tick;
  for (const id of target.players.keys()) {
    if (!Object.hasOwn(world.players, id)) target.players.delete(id);
  }
  for (const player of Object.values(world.players)) {
    let view = target.players.get(player.id);
    if (!view) {
      view = new PlayerState();
      view.playerId = player.id;
      view.nickname = player.nickname;
      target.players.set(player.id, view);
    }
    view.x = player.x;
    view.z = player.z;
  }
}

const cell = (c: { x: number; y: number }) => ({ x: c.x, y: c.y });
const wall = (w: { x: number; y: number; side: 0 | 1 | 2 | 3 }) => ({
  x: w.x,
  y: w.y,
  side: w.side,
});
const action = (a: ActiveSelf['action']) =>
  a
    ? {
        kind: a.kind,
        from: { x: a.from.x, y: a.from.y, dir: a.from.dir },
        to: { x: a.to.x, y: a.to.y, dir: a.to.dir },
        startTick: a.startTick,
        endTick: a.endTick,
      }
    : null;

function projectTerrain(terrain: readonly KnownTerrain[]): KnownTerrain[] {
  return terrain.map((t) =>
    t.kind === 'wall' ? { ...wall(t), kind: 'wall' } : { ...cell(t), kind: 'floor' },
  );
}

function projectExit(exit: KnownExit): KnownExit {
  return {
    exitId: exit.exitId,
    ownerId: exit.ownerId,
    wall: wall(exit.wall),
    approach: cell(exit.approach),
  };
}

function projectOwned(equipment: OwnedEquipment): OwnedEquipment {
  const base = {
    equipmentId: equipment.equipmentId,
    state: equipment.state,
    armedTick: equipment.armedTick,
  };
  return equipment.kind === 'sensor'
    ? { ...base, kind: 'sensor', cell: cell(equipment.cell), wall: wall(equipment.wall) }
    : { ...base, kind: 'trap', cell: cell(equipment.cell) };
}

/**
 * S15P21C204-340. Maps an enemy's real playerId to the opaque id the recipient may see. The
 * identity mapping keeps a caller that has no aliases (tests, tools) on the real ids.
 */
export type EnemyAlias = (playerId: string) => string;
export const revealIds: EnemyAlias = (playerId) => playerId;

/** Visible entities by explicit allowlist. Sensors require a wall face; traps never carry one. */
export function projectVisibleEntities(
  entities: readonly VisibleEntity[],
  selfRole: ActiveSelf['role'] | null,
  alias: EnemyAlias = revealIds,
): VisibleEntity[] {
  const out: VisibleEntity[] = [];
  for (const entity of entities) {
    if (entity.kind === 'player') {
      const projected: VisibleEntity = {
        id: entity.id,
        kind: 'player',
        cell: cell(entity.cell),
        dir: entity.dir,
        action: action(entity.action),
      };
      // Only allied role markers are exposed; enemy roles and name tags never leave the server.
      // An enemy's playerId does not leave either (340): with the roster's id → nickname table
      // it named the other team. The alias is what the media bindings use for the same player.
      if (entity.role !== undefined && selfRole !== null && entity.role === selfRole)
        out.push({ ...projected, role: entity.role });
      else out.push({ ...projected, id: alias(entity.id) });
    } else if (entity.kind === 'sensor') {
      if (!entity.wall) continue;
      out.push({
        id: entity.id,
        kind: 'sensor',
        cell: cell(entity.cell),
        wall: wall(entity.wall),
        state: entity.state,
      });
    } else if (entity.kind === 'trap') {
      out.push({ id: entity.id, kind: 'trap', cell: cell(entity.cell), state: entity.state });
    }
  }
  return out;
}

export function projectSelf(
  self: ActiveSelf | EndedSelf | null,
  loading: LoadingView | null,
): ActiveSelf | EndedSelf | null {
  if (!self) return null;
  if (self.status !== 'ACTIVE')
    return { playerId: self.playerId, role: self.role, status: self.status };
  return {
    playerId: self.playerId,
    role: self.role,
    status: 'ACTIVE',
    cell: cell(self.cell),
    dir: self.dir,
    action: action(self.action),
    equipment: { sensor: self.equipment.sensor, trap: self.equipment.trap },
    ownedEquipment: self.ownedEquipment.map(projectOwned),
    restraintUntilTick: self.restraintUntilTick,
    restraintImmuneUntilTick: self.restraintImmuneUntilTick,
    installation: self.installation
      ? {
          installationId: self.installation.installationId,
          kind: self.installation.kind,
          startTick: self.installation.startTick,
          endTick: self.installation.endTick,
          armedTick: self.installation.armedTick,
        }
      : null,
    exchange: self.exchange
      ? {
          exchangeId: self.exchange.exchangeId,
          fromPlayerId: self.exchange.fromPlayerId,
          toPlayerId: self.exchange.toPlayerId,
          direction: self.exchange.fromPlayerId === self.playerId ? 'outgoing' : 'incoming',
          expiresAtTick: self.exchange.expiresAtTick,
        }
      : null,
    challenge: self.challenge
      ? {
          challengeId: self.challenge.challengeId,
          exitId: self.challenge.exitId,
          poseKind: self.challenge.poseKind,
          startedAtTick: self.challenge.startedAtTick,
          minSuccessTick: self.challenge.minSuccessTick,
          expiresAtTick: self.challenge.expiresAtTick,
        }
      : null,
    loading: loading
      ? {
          loadId: loading.loadId,
          initialViewVersion: loading.initialViewVersion,
          mediaInstanceId: loading.mediaInstanceId,
          receiverGeneration: loading.receiverGeneration,
          assetVersion: loading.assetVersion,
        }
      : null,
  };
}

/**
 * S15P21C204-269. The view an ended runner receives while watching `targetId`: the target's
 * memory, sight, exits and allied markers, exactly as the target itself would get them, plus
 * where the target stands so the spectator's camera can follow. The spectator's own self stays
 * the minimal ended record. Nothing here is computed from the spectator's former position.
 */
export function projectSpectateBody<State>(
  core: CorePort<State>,
  state: State,
  playerId: string,
  targetId: string,
  candidates: readonly string[],
  alias: EnemyAlias = revealIds,
): PrivateViewBody {
  const self = projectSelf(core.getPlayerSelf(state, playerId), null);
  const target = core.getPlayerSelf(state, targetId);
  if (!self || self.status === 'ACTIVE' || !target || target.status !== 'ACTIVE')
    return projectPrivateBody(core, state, playerId, null, alias);
  const knowledge = core.getPlayerKnowledge(state, targetId);
  const surfaces = core.getVisibleSurfaces(state, targetId);
  return {
    mapVersion: knowledge.mapVersion,
    knownTerrain: projectTerrain(knowledge.knownTerrain),
    knownActiveExits: target.role === 'runner' ? knowledge.knownActiveExits.map(projectExit) : [],
    self,
    visibleCells: surfaces.visibleCells.map(cell),
    visibleWallFaces: surfaces.visibleWallFaces.map(wall),
    visibleEntities: projectVisibleEntities(
      core.getVisibleEntities(state, targetId),
      target.role,
      alias,
    ),
    spectating: {
      targetId,
      cell: cell(target.cell),
      dir: target.dir,
      action: action(target.action),
      candidates: [...candidates],
    },
  };
}

/**
 * Builds the recipient's allowlisted view body from core selectors only. Ended players keep
 * their minimal self and receive no terrain, entities or surfaces. Taggers never receive exits.
 */
export function projectPrivateBody<State>(
  core: CorePort<State>,
  state: State,
  playerId: string,
  loading: LoadingView | null,
  alias: EnemyAlias = revealIds,
): PrivateViewBody {
  const self = projectSelf(core.getPlayerSelf(state, playerId), loading);
  if (!self || self.status !== 'ACTIVE') {
    return {
      mapVersion: 0,
      knownTerrain: [],
      knownActiveExits: [],
      self,
      visibleCells: [],
      visibleWallFaces: [],
      visibleEntities: [],
    };
  }
  const knowledge = core.getPlayerKnowledge(state, playerId);
  const surfaces = core.getVisibleSurfaces(state, playerId);
  return {
    mapVersion: knowledge.mapVersion,
    knownTerrain: projectTerrain(knowledge.knownTerrain),
    knownActiveExits: self.role === 'runner' ? knowledge.knownActiveExits.map(projectExit) : [],
    self,
    visibleCells: surfaces.visibleCells.map(cell),
    visibleWallFaces: surfaces.visibleWallFaces.map(wall),
    visibleEntities: projectVisibleEntities(
      core.getVisibleEntities(state, playerId),
      self.role,
      alias,
    ),
  };
}
