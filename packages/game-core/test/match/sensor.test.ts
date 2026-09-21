import { describe, expect, it } from 'vitest';

import type { DomainEvent } from '../../src/match/core-types.js';
import type { MatchState } from '../../src/match/engine.js';
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

function idleUntil(state: MatchState, from: number, to: number): MatchState {
  let next = state;
  for (let tick = from; tick <= to; tick += 1) next = step(next, tick).state;
  return next;
}

function markers(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'HUNTER_MARKER');
}

function sensorSounds(events: readonly DomainEvent[]) {
  return events.filter((e) => e.type === 'SPATIAL_SOUND' && e.sound.kind === 'sensor');
}

function device(state: MatchState, ownerId = 't-a') {
  return player(state, ownerId).ownedEquipment[0]!;
}

/**
 * A sensor on the approach cell (5,3) facing the inner wall (6,3), installed by
 * t-a at tick 10, complete at 20 and ARMED at 40. The installer is moved away
 * afterwards so the cell is free for runners.
 */
function armedSensor(): MatchState {
  const installed = step(place(startedMatch(1), { 't-a': { x: 5, y: 3, dir: 1 } }), 10, [
    command('t-a', 'INSTALL', { kind: 'sensor' }),
  ]).state;
  const complete = idleUntil(installed, 11, 20);
  return place(complete, { 't-a': { x: 8, y: 16, dir: 0 } });
}

describe('walk-through sensor single shot', () => {
  it('does not fire for a runner already standing there when it arms', () => {
    // The runner stands on (5,3) from before the arming tick.
    const standing = place(armedSensor(), { 'r-a': { x: 5, y: 3, dir: 3 } });
    let state = standing;
    for (let tick = 21; tick <= 45; tick += 1) {
      const result = step(state, tick);
      expect(markers(result.events)).toEqual([]);
      expect(sensorSounds(result.events)).toEqual([]);
      state = result.state;
    }
    expect(device(state).state).toBe('ARMED');

    // Walking out and back in is a new entry and fires it once. The held intent
    // is released before arrival so the runner stops on (4,3).
    const leaving = step(state, 46, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const stopped = step(idleUntil(leaving, 47, 49), 50, [
      command('r-a', 'MOVE_INTENT', { direction: null }),
    ]).state;
    const out = idleUntil(stopped, 51, 55);
    expect(player(out, 'r-a').cell).toEqual({ x: 4, y: 3 });
    expect(device(out).state).toBe('ARMED');
    const back = step(out, 56, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]).state;
    const entered = idleUntil(back, 57, 64);
    expect(player(entered, 'r-a').cell).toEqual({ x: 4, y: 3 });
    const fired = step(entered, 65);
    expect(player(fired.state, 'r-a').cell).toEqual({ x: 5, y: 3 });
    expect(device(fired.state).state).toBe('SPENT');
    expect(markers(fired.events)).toHaveLength(1);
    expect(sensorSounds(fired.events)).toHaveLength(1);
  });

  it('sends one anonymous past-position marker and one separate sound', () => {
    const ready = place(armedSensor(), { 'r-a': { x: 4, y: 3, dir: 1 } });
    const armed = idleUntil(ready, 21, 40);
    expect(device(armed).state).toBe('ARMED');
    const walking = step(armed, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const waiting = idleUntil(walking, 42, 49);
    const fired = step(waiting, 50);

    const marker = markers(fired.events)[0];
    if (!marker || marker.type !== 'HUNTER_MARKER') throw new Error('expected a marker');
    expect(marker.payload).toEqual({
      markerId: 'mk-eq-1',
      kind: 'sensor',
      point: { x: 5, y: 3 },
      occurredTick: 50,
      // A sensor marker shows at once and lives 40 ticks.
      showAtTick: 50,
      expiresTick: 90,
    });
    expect([...marker.audience].sort()).toEqual(['t-a', 't-b', 't-c']);
    // No identity of the detected runner anywhere in the tagger event.
    expect(JSON.stringify(marker.payload)).not.toContain('r-a');

    const sound = sensorSounds(fired.events)[0];
    if (!sound || sound.type !== 'SPATIAL_SOUND') throw new Error('expected a sound');
    expect(sound.sound).toEqual({
      eventId: sound.sound.eventId,
      tick: 50,
      kind: 'sensor',
      cell: { x: 5, y: 3 },
    });
    expect(sound.sound.sourcePlayerId).toBeUndefined();
    // The map event and the sound event never share an id.
    expect(sound.sound.eventId).not.toBe(marker.eventId);

    // Spent once: the next ticks add nothing.
    expect(device(fired.state).state).toBe('SPENT');
    let after = fired.state;
    for (const tick of [51, 52, 90, 91]) {
      const result = step(after, tick);
      expect(markers(result.events)).toEqual([]);
      expect(sensorSounds(result.events)).toEqual([]);
      after = result.state;
    }
  });

  it('fires once when two runners enter on the same tick', () => {
    // (4,3) from the west and (5,2) from the north both lead onto (5,3).
    const ready = place(armedSensor(), {
      'r-a': { x: 4, y: 3, dir: 1 },
      'r-b': { x: 5, y: 2, dir: 2 },
    });
    const armed = idleUntil(ready, 21, 40);
    const walking = step(armed, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('r-b', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const fired = step(idleUntil(walking, 42, 49), 50);
    expect(player(fired.state, 'r-a').cell).toEqual({ x: 5, y: 3 });
    expect(player(fired.state, 'r-b').cell).toEqual({ x: 5, y: 3 });
    expect(device(fired.state).state).toBe('SPENT');
    expect(markers(fired.events)).toHaveLength(1);
    expect(sensorSounds(fired.events)).toHaveLength(1);
    expect(JSON.stringify(markers(fired.events))).not.toContain('r-b');
  });

  it('detects a runner inside its restraint immunity window', () => {
    const ready = place(armedSensor(), { 'r-a': { x: 4, y: 3, dir: 1 } });
    const armed = idleUntil(ready, 21, 40);
    const players = new Map(armed.players);
    // Immunity is a trap rule; it is no exemption from detection.
    players.set('r-a', { ...player(armed, 'r-a'), restraintImmuneUntilTick: 90 });
    const immune: MatchState = { ...armed, players };
    const walking = step(immune, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const fired = step(idleUntil(walking, 42, 49), 50);
    expect(device(fired.state).state).toBe('SPENT');
    expect(markers(fired.events)).toHaveLength(1);
  });

  it('keeps the device armed when the only candidate is captured on the same tick', () => {
    // r-a walks east onto (5,3) while t-b walks south onto the same cell.
    const ready = place(armedSensor(), {
      'r-a': { x: 4, y: 3, dir: 1 },
      't-b': { x: 5, y: 2, dir: 2 },
    });
    const armed = idleUntil(ready, 21, 40);
    const walking = step(armed, 41, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-b', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const grabbing = step(idleUntil(walking, 42, 48), 49, [
      command('t-b', 'GRAB_INTENT', {}),
    ]).state;
    const contact = step(grabbing, 50);
    expect(player(contact.state, 'r-a').status).toBe('CAPTURED');
    // Capture is settled first, so no ACTIVE candidate is left for the sensor.
    expect(device(contact.state).state).toBe('ARMED');
    expect(markers(contact.events)).toEqual([]);
    expect(sensorSounds(contact.events)).toEqual([]);
  });

  it('stays quiet while the device is still unarmed', () => {
    const ready = place(armedSensor(), { 'r-a': { x: 4, y: 3, dir: 1 } });
    expect(device(ready).state).toBe('UNARMED');
    // The move completes at 30, ten ticks before the device arms at 40.
    const walking = step(ready, 21, [
      command('r-a', 'MOVE_INTENT', { direction: 'forward' }),
    ]).state;
    const early = step(idleUntil(walking, 22, 29), 30);
    expect(player(early.state, 'r-a').cell).toEqual({ x: 5, y: 3 });
    expect(markers(early.events)).toEqual([]);
    expect(sensorSounds(early.events)).toEqual([]);
    // Standing on the cell as it arms is still no entry.
    const armed = idleUntil(early.state, 31, 45);
    expect(device(armed).state).toBe('ARMED');
  });
});
