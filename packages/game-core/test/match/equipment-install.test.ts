import { describe, expect, it } from 'vitest';

import type { MatchState } from '../../src/match/engine.js';
import { getPlayerSelf, getVisibleEntities } from '../../src/match/engine.js';
import { frontWallFace } from '../../src/match/equipment/install.js';
import { exitOfOwner } from '../../src/match/exits/registry.js';
import { command, player, startedMatch, step } from './match-fixture.js';

/** Places players on chosen cells/dirs without moving through the maze. */
function place(
  state: MatchState,
  placements: Record<string, { x: number; y: number; dir?: 0 | 1 | 2 | 3 }>,
): MatchState {
  const players = new Map(state.players);
  for (const [id, p] of Object.entries(placements)) {
    const record = player(state, id);
    players.set(id, {
      ...record,
      cell: { x: p.x, y: p.y },
      dir: p.dir ?? record.dir,
      action: null,
    });
  }
  return { ...state, players };
}

/** Runs the empty ticks from `from` to `to` inclusive. */
function idleUntil(state: MatchState, from: number, to: number): MatchState {
  let next = state;
  for (let tick = from; tick <= to; tick += 1) next = step(next, tick).state;
  return next;
}

/**
 * t-a on (5,3) faces the inner wall (6,3) and t-b on (5,4) the inner wall
 * (6,4). Neither cell is a start cell, so both are open for a device.
 */
function taggersFacingWalls(): MatchState {
  return place(startedMatch(1), {
    't-a': { x: 5, y: 3, dir: 1 },
    't-b': { x: 5, y: 4, dir: 1 },
  });
}

describe('tagger equipment install, cancel and arming', () => {
  it('starts every tagger with one sensor and one trap, runners with none', () => {
    const state = startedMatch(1);
    for (const id of ['t-a', 't-b', 't-c']) {
      expect(player(state, id).equipment).toEqual({ sensor: 1, trap: 1 });
      expect(player(state, id).ownedEquipment).toEqual([]);
    }
    for (const id of ['r-a', 'r-b', 'r-c']) {
      expect(player(state, id).equipment).toEqual({ sensor: 0, trap: 0 });
    }
    // A runner cannot install at all while the item decision is open.
    const refused = step(place(startedMatch(1), { 'r-a': { x: 5, y: 3, dir: 1 } }), 10, [
      command('r-a', 'INSTALL', { kind: 'sensor' }),
    ]);
    expect(refused.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(refused.state.installations.size).toBe(0);
  });

  it('reserves without spending stock and keeps stock when canceled before the end', () => {
    const started = step(taggersFacingWalls(), 10, [command('t-a', 'INSTALL', { kind: 'sensor' })]);
    expect(started.outcomes).toEqual([
      expect.objectContaining({ actorId: 't-a', result: 'applied', code: null }),
    ]);
    expect(getPlayerSelf(started.state, 't-a')).toMatchObject({
      installation: {
        installationId: 'ins-1',
        kind: 'sensor',
        startTick: 10,
        endTick: 20,
        armedTick: 40,
      },
      equipment: { sensor: 1, trap: 1 },
      ownedEquipment: [],
    });

    const canceled = step(idleUntil(started.state, 11, 18), 19, [
      command('t-a', 'INSTALL_CANCEL', { installationId: 'ins-1' }),
    ]);
    expect(canceled.outcomes[0]).toMatchObject({ result: 'applied', code: null });
    expect(player(canceled.state, 't-a').equipment).toEqual({ sensor: 1, trap: 1 });
    expect(player(canceled.state, 't-a').ownedEquipment).toEqual([]);
    expect(player(canceled.state, 't-a').installation).toBeNull();
    expect(canceled.state.installations.size).toBe(0);
    // Nothing appears at the former end or arming tick.
    const later = idleUntil(canceled.state, 20, 45);
    expect(player(later, 't-a').ownedEquipment).toEqual([]);
    expect(player(later, 't-a').equipment).toEqual({ sensor: 1, trap: 1 });
  });

  it('spends one charge at the end tick and arms the device 20 ticks later', () => {
    const started = step(taggersFacingWalls(), 10, [
      command('t-a', 'INSTALL', { kind: 'sensor' }),
    ]).state;
    const waiting = idleUntil(started, 11, 19);
    expect(player(waiting, 't-a').equipment).toEqual({ sensor: 1, trap: 1 });
    expect(player(waiting, 't-a').ownedEquipment).toEqual([]);

    const completed = step(waiting, 20).state;
    expect(player(completed, 't-a').equipment).toEqual({ sensor: 0, trap: 1 });
    expect(player(completed, 't-a').installation).toBeNull();
    expect(player(completed, 't-a').ownedEquipment).toEqual([
      {
        equipmentId: 'eq-1',
        state: 'UNARMED',
        armedTick: 40,
        kind: 'sensor',
        cell: { x: 5, y: 3 },
        wall: { x: 6, y: 3, side: 3 },
      },
    ]);
    // The completion produces no second outcome for the original request.
    expect(step(completed, 21).outcomes).toEqual([]);

    const unarmed = idleUntil(completed, 21, 39);
    expect(player(unarmed, 't-a').ownedEquipment[0]!.state).toBe('UNARMED');
    const armed = step(unarmed, 40).state;
    expect(player(armed, 't-a').ownedEquipment[0]).toMatchObject({
      equipmentId: 'eq-1',
      state: 'ARMED',
      armedTick: 40,
    });
    // A trap keeps a floor cell only, with no wall field.
    const trapper = step(armed, 41, [command('t-b', 'INSTALL', { kind: 'trap' })]).state;
    const withTrap = idleUntil(trapper, 42, 51);
    const trap = player(withTrap, 't-b').ownedEquipment[0]!;
    expect(Object.keys(trap).sort()).toEqual(['armedTick', 'cell', 'equipmentId', 'kind', 'state']);
    expect(trap).toMatchObject({ kind: 'trap', cell: { x: 5, y: 4 } });
  });

  it('treats an exit wall exactly like any other inner wall', () => {
    // exit-3's wall (6,10) is approached from (7,10); (7,3) faces the same kind
    // of inner wall with no exit behind it.
    const base = place(startedMatch(1), {
      't-a': { x: 7, y: 10, dir: 3 },
      't-b': { x: 7, y: 3, dir: 3 },
    });
    const exit = exitOfOwner(base.exits, 'r-c')!;
    expect(frontWallFace(base.layout.topology, { x: 7, y: 10 }, 3)).toEqual(exit.wall);

    const result = step(base, 10, [
      command('t-a', 'INSTALL', { kind: 'sensor' }),
      command('t-b', 'INSTALL', { kind: 'sensor' }),
    ]);
    // Same outcome and same timing on the exit wall and the plain wall.
    expect(result.outcomes.map((o) => [o.result, o.code])).toEqual([
      ['applied', null],
      ['applied', null],
    ]);
    const both = [...result.state.installations.values()];
    expect(both.map((p) => p.endTick)).toEqual([20, 20]);
    const completed = idleUntil(result.state, 11, 20);
    expect(player(completed, 't-a').ownedEquipment[0]).toMatchObject({ wall: exit.wall });
    // The exit stays hidden: the installer learns nothing about it.
    expect(getPlayerSelf(completed, 't-a')).toMatchObject({ role: 'tagger' });
    expect(completed.exits.get(exit.exitId)!.active).toBe(true);
  });

  it('refuses a start cell, an outer wall, and a cell that already holds a device', () => {
    // A runner start cell is closed to devices, so a trap there is refused.
    const onStart = step(place(startedMatch(1), { 't-a': { x: 2, y: 2, dir: 1 } }), 10, [
      command('t-a', 'INSTALL', { kind: 'trap' }),
    ]);
    expect(onStart.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });

    // Facing the outer boundary wall is not an install position.
    expect(frontWallFace(onStart.state.layout.topology, { x: 1, y: 1 }, 3)).toBeNull();
    const outer = step(place(startedMatch(1), { 't-a': { x: 1, y: 1, dir: 3 } }), 10, [
      command('t-a', 'INSTALL', { kind: 'sensor' }),
    ]);
    expect(outer.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });

    // One device per cell, whoever owns it.
    const trapped = idleUntil(
      step(taggersFacingWalls(), 10, [command('t-b', 'INSTALL', { kind: 'trap' })]).state,
      11,
      20,
    );
    expect(player(trapped, 't-b').ownedEquipment).toHaveLength(1);
    const crowded = step(place(trapped, { 't-c': { x: 5, y: 4, dir: 1 } }), 21, [
      command('t-c', 'INSTALL', { kind: 'trap' }),
      command('t-c', 'INSTALL', { kind: 'sensor' }),
    ]);
    expect(crowded.outcomes.map((o) => o.code)).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
    expect(crowded.state.installations.size).toBe(0);

    // Opposite faces of one wall cell are different positions and both allowed.
    const facing = place(startedMatch(1), {
      't-a': { x: 5, y: 3, dir: 1 },
      't-b': { x: 7, y: 3, dir: 3 },
    });
    const twoFaces = step(facing, 10, [
      command('t-a', 'INSTALL', { kind: 'sensor' }),
      command('t-b', 'INSTALL', { kind: 'sensor' }),
    ]);
    expect(twoFaces.outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);
    const walls = [...twoFaces.state.installations.values()].map((p) => p.wall);
    expect(walls).toEqual([
      { x: 6, y: 3, side: 3 },
      { x: 6, y: 3, side: 1 },
    ]);
  });

  it('refuses a moving installer and drops a reservation left behind for free', () => {
    // A tagger with a running action cannot start an installation.
    const moving = step(taggersFacingWalls(), 10, [
      command('t-b', 'MOVE_INTENT', { direction: 'back' }),
    ]).state;
    expect(player(moving, 't-b').action).not.toBeNull();
    const refused = step(moving, 11, [command('t-b', 'INSTALL', { kind: 'trap' })]);
    expect(refused.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(player(refused.state, 't-b').equipment).toEqual({ sensor: 1, trap: 1 });
    expect(refused.state.installations.size).toBe(0);

    // Walking away mid-installation costs no charge and leaves no device.
    const started = step(taggersFacingWalls(), 10, [
      command('t-a', 'INSTALL', { kind: 'sensor' }),
    ]).state;
    const walked = step(started, 12, [command('t-a', 'MOVE_INTENT', { direction: 'back' })]);
    expect(walked.outcomes[0]).toMatchObject({ result: 'applied' });
    // The upkeep of the next tick sees the running action and releases the slot.
    const released = step(walked.state, 13);
    expect(released.state.installations.size).toBe(0);
    expect(player(released.state, 't-a').installation).toBeNull();
    const after = idleUntil(released.state, 14, 45);
    expect(player(after, 't-a').equipment).toEqual({ sensor: 1, trap: 1 });
    expect(player(after, 't-a').ownedEquipment).toEqual([]);
  });

  // S15P21C204-339. A held move that completes on the install tick must not resume under the pose.
  it('keeps a reservation made on the tick a held move completed, instead of silently dropping it', () => {
    // t-b walks back from (5,4) while holding the key: the move runs 10..19 and the hold stays.
    const walking = step(taggersFacingWalls(), 10, [
      command('t-b', 'MOVE_INTENT', { direction: 'back' }),
    ]).state;
    expect(player(walking, 't-b').heldMove).toMatchObject({ direction: 'back' });
    const moving = idleUntil(walking, 11, 18);
    expect(player(moving, 't-b').action).not.toBeNull();

    // The step completes the move, then takes the INSTALL: the installer is standing still.
    const installed = step(moving, 19, [command('t-b', 'INSTALL', { kind: 'trap' })]);
    expect(installed.outcomes[0]).toMatchObject({ result: 'applied', code: null });
    const installer = player(installed.state, 't-b');
    expect(installer.installation).toMatchObject({ kind: 'trap', startTick: 19, endTick: 29 });
    // The old hold is gone and no move resumed in the same tick.
    expect(installer.heldMove).toBeNull();
    expect(installer.action).toBeNull();

    // The next tick's upkeep sees a standing installer and keeps the slot.
    const upkeep = step(installed.state, 20);
    expect(upkeep.state.installations.size).toBe(1);
    expect(player(upkeep.state, 't-b').installation).not.toBeNull();

    // Standing to the end places the trap and spends one charge, as an ordinary install does.
    const finished = idleUntil(upkeep.state, 21, 29);
    expect(player(finished, 't-b').installation).toBeNull();
    expect(player(finished, 't-b').equipment).toEqual({ sensor: 1, trap: 0 });
    expect(player(finished, 't-b').ownedEquipment).toEqual([
      expect.objectContaining({ kind: 'trap', cell: installer.cell }),
    ]);
  });

  it('rejects a cancel on and after the completion tick without rolling anything back', () => {
    const started = step(taggersFacingWalls(), 10, [
      command('t-a', 'INSTALL', { kind: 'sensor' }),
    ]).state;
    const waiting = idleUntil(started, 11, 19);
    // The upkeep runs before this tick's commands: at 20 the device already exists.
    const late = step(waiting, 20, [command('t-a', 'INSTALL_CANCEL', { installationId: 'ins-1' })]);
    expect(late.outcomes).toEqual([
      expect.objectContaining({ result: 'rejected', code: 'STALE_REQUEST' }),
    ]);
    expect(player(late.state, 't-a').equipment).toEqual({ sensor: 0, trap: 1 });
    expect(player(late.state, 't-a').ownedEquipment).toHaveLength(1);

    // A later cancel of the same id changes nothing either.
    const again = step(late.state, 21, [
      command('t-a', 'INSTALL_CANCEL', { installationId: 'ins-1' }),
    ]);
    expect(again.outcomes[0]).toMatchObject({ result: 'rejected', code: 'STALE_REQUEST' });
    expect(player(again.state, 't-a').equipment).toEqual({ sensor: 0, trap: 1 });
    expect(player(again.state, 't-a').ownedEquipment).toHaveLength(1);

    // Another tagger cannot cancel someone else's reservation.
    const other = step(taggersFacingWalls(), 10, [
      command('t-a', 'INSTALL', { kind: 'sensor' }),
    ]).state;
    const stranger = step(other, 11, [
      command('t-b', 'INSTALL_CANCEL', { installationId: 'ins-1' }),
    ]);
    expect(stranger.outcomes[0]).toMatchObject({ result: 'rejected', code: 'NOT_ALLOWED' });
    expect(stranger.state.installations.size).toBe(1);
  });

  it('shows a device in real sight as an entity, sensors always with their wall', () => {
    const base = place(taggersFacingWalls(), { 'r-a': { x: 2, y: 3, dir: 1 } });
    const installed = idleUntil(
      step(base, 10, [command('t-a', 'INSTALL', { kind: 'sensor' })]).state,
      11,
      20,
    );
    const seen = getVisibleEntities(installed, 'r-a').filter((e) => e.kind !== 'player');
    expect(seen).toEqual([
      {
        id: 'eq-1',
        kind: 'sensor',
        cell: { x: 5, y: 3 },
        wall: { x: 6, y: 3, side: 3 },
        state: 'UNARMED',
      },
    ]);
    // A runner that cannot see the cell gets no entity for it.
    expect(getVisibleEntities(installed, 'r-b').filter((e) => e.kind !== 'player')).toEqual([]);
    // Arming is visible in the entity state, and no owner id is attached.
    const armed = idleUntil(installed, 21, 40);
    const after = getVisibleEntities(armed, 'r-a').filter((e) => e.kind !== 'player');
    expect(after[0]).toMatchObject({ id: 'eq-1', state: 'ARMED' });
    expect(JSON.stringify(after)).not.toContain('t-a');
  });
});
