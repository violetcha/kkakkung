import { describe, expect, it } from 'vitest';

import { addPlayer, createWorld, removePlayer, stepWorld } from '../src/world.js';

describe('world lifecycle', () => {
  it('creates an empty validated world', () => {
    expect(createWorld({ halfExtent: 10, speed: 4 })).toEqual({
      tick: 0,
      players: {},
    });
  });

  it.each([
    { halfExtent: 0, speed: 1 },
    { halfExtent: -1, speed: 1 },
    { halfExtent: Number.NaN, speed: 1 },
    { halfExtent: 1, speed: -1 },
    { halfExtent: 1, speed: Number.POSITIVE_INFINITY },
  ])('rejects invalid world options %#', (options) => {
    expect(() => createWorld(options)).toThrow(RangeError);
  });

  it('registers and removes players without mutating prior states', () => {
    const empty = createWorld({ halfExtent: 10, speed: 4 });
    const joined = addPlayer(empty, { id: 'p1', nickname: '까꿍' });
    const left = removePlayer(joined, 'p1');

    expect(empty.players).toEqual({});
    expect(joined.players.p1).toEqual({ id: 'p1', nickname: '까꿍', x: 0, z: 0, lastSeq: -1 });
    expect(left.players).toEqual({});
    expect(joined.players.p1).toBeDefined();
  });

  it.each([
    { id: '', nickname: 'valid' },
    { id: 'p1', nickname: '' },
    { id: 'p1', nickname: 'a'.repeat(21) },
  ])('rejects invalid player registration %#', (player) => {
    const world = createWorld({ halfExtent: 10, speed: 4 });
    expect(() => addPlayer(world, player)).toThrow();
  });

  it('rejects duplicate registration and invalid removal identifiers', () => {
    const joined = addPlayer(createWorld({ halfExtent: 10, speed: 4 }), {
      id: 'p1',
      nickname: 'one',
    });
    expect(() => addPlayer(joined, { id: 'p1', nickname: 'two' })).toThrow();
    expect(() => removePlayer(joined, '')).toThrow();
  });
});

describe('deterministic movement', () => {
  it('normalizes diagonal movement and advances one tick immutably', () => {
    const initial = addPlayer(createWorld({ halfExtent: 10, speed: 4 }), {
      id: 'p1',
      nickname: 'one',
    });
    const next = stepWorld(initial, [{ playerId: 'p1', seq: 0, x: 1, z: 1 }], 0.5);

    expect(next.tick).toBe(1);
    expect(next.players.p1?.x).toBeCloseTo(Math.SQRT2);
    expect(next.players.p1?.z).toBeCloseTo(Math.SQRT2);
    expect(next.players.p1?.lastSeq).toBe(0);
    expect(initial.tick).toBe(0);
    expect(initial.players.p1).toMatchObject({ x: 0, z: 0, lastSeq: -1 });
  });

  it('clamps movement at the square map boundary', () => {
    let world = addPlayer(createWorld({ halfExtent: 1, speed: 5 }), {
      id: 'p1',
      nickname: 'one',
    });
    world = stepWorld(world, [{ playerId: 'p1', seq: 0, x: 1, z: -1 }], 1);
    expect(world.players.p1).toMatchObject({ x: 1, z: -1 });
  });

  it('ignores stale, duplicate, and unregistered commands', () => {
    let world = addPlayer(createWorld({ halfExtent: 10, speed: 1 }), {
      id: 'p1',
      nickname: 'one',
    });
    world = stepWorld(world, [{ playerId: 'p1', seq: 2, x: 1, z: 0 }], 1);
    const next = stepWorld(
      world,
      [
        { playerId: 'missing', seq: 99, x: 1, z: 0 },
        { playerId: 'p1', seq: 2, x: 1, z: 0 },
        { playerId: 'p1', seq: 1, x: 1, z: 0 },
      ],
      1,
    );
    expect(next.players.p1).toMatchObject({ x: 1, z: 0, lastSeq: 2 });
    expect(next.tick).toBe(2);
  });

  it('uses commands only for their supplied tick', () => {
    let world = addPlayer(createWorld({ halfExtent: 10, speed: 1 }), {
      id: 'p1',
      nickname: 'one',
    });
    world = stepWorld(world, [{ playerId: 'p1', seq: 0, x: 1, z: 0 }], 1);
    const stopped = stepWorld(world, [], 1);
    expect(stopped.players.p1).toMatchObject({ x: 1, z: 0, lastSeq: 0 });
  });

  it('applies only the newest command for each player in a tick', () => {
    const world = addPlayer(createWorld({ halfExtent: 10, speed: 1 }), {
      id: 'p1',
      nickname: 'one',
    });
    const next = stepWorld(
      world,
      [
        { playerId: 'p1', seq: 2, x: 0, z: 1 },
        { playerId: 'p1', seq: 1, x: 1, z: 0 },
      ],
      1,
    );
    expect(next.players.p1).toMatchObject({ x: 0, z: 1, lastSeq: 2 });
  });

  it.each([
    { commands: [{ playerId: 'p1', seq: -1, x: 0, z: 0 }], dt: 1 },
    { commands: [{ playerId: 'p1', seq: 0, x: 2, z: 0 }], dt: 1 },
    { commands: [{ playerId: 'p1', seq: 0, x: 0, z: Number.NaN }], dt: 1 },
    { commands: [], dt: -0.1 },
    { commands: [], dt: Number.POSITIVE_INFINITY },
  ])('rejects invalid direct domain input %#', ({ commands, dt }) => {
    const world = addPlayer(createWorld({ halfExtent: 10, speed: 1 }), {
      id: 'p1',
      nickname: 'one',
    });
    expect(() => stepWorld(world, commands, dt)).toThrow();
  });
});
