import { expect, it } from 'vitest';
import { createSoloWorld } from './solo-world';
import { challengeKeys } from '../pose/key-challenge';

it('credits completed movement, quarter turns and an intentional neutral stop, not command receipt', () => {
  let clock = 0;
  const world = createSoloWorld(() => clock);
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: 'forward' } });
  expect(world.snapshot.completed).toEqual([]);
  expect(world.snapshot.self.action?.to).toMatchObject({ x: 2, y: 2, dir: 0 });
  clock = 450;
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: null } }, true);
  expect(world.snapshot.completed).toEqual(['forward']);
  clock = 950;
  world.poll();
  expect(world.snapshot.completed).toContain('neutral');
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: 'back' } });
  clock += 450;
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: null } }, true);
  world.dispatch({ type: 'TURN', payload: { direction: 'left' } });
  clock += 300;
  world.poll();
  expect(world.snapshot.self).toMatchObject({ cell: { x: 2, y: 3 }, dir: 3 });
  world.dispatch({ type: 'TURN', payload: { direction: 'right' } });
  clock += 300;
  world.poll();
  expect(world.snapshot.self.dir).toBe(0);
  expect(world.snapshot.completed).toEqual(
    expect.arrayContaining(['forward', 'back', 'left', 'right', 'neutral']),
  );
});

it('blocks walls and bounds a held action to one queued turn without catching up after a stalled tab', () => {
  let clock = 0;
  const world = createSoloWorld(() => clock);
  world.lesson('runner');
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: 'forward' } });
  expect(world.snapshot.self.action).toBeNull();
  expect(world.snapshot.completed).toEqual([]);
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: null } });
  world.dispatch({ type: 'TURN', payload: { direction: 'left' } });
  world.dispatch({ type: 'TURN', payload: { direction: 'left' } });
  world.dispatch({ type: 'TURN', payload: { direction: 'right' } });
  clock = 5000;
  world.poll();
  expect(world.snapshot.self.action?.to.dir).toBe(0);
  clock = 5300;
  world.poll();
  expect(world.snapshot.self.action).toBeNull();
  expect(world.snapshot.self.cell).toEqual({ x: 2, y: 1 });
});

it('does not credit an input timeout or focus loss as neutral, and discards partial actions on pause', () => {
  let clock = 0;
  const world = createSoloWorld(() => clock);
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: 'forward' } });
  clock = 200;
  world.setEnabled(false);
  clock = 5000;
  world.poll();
  expect(world.snapshot.self.cell).toEqual({ x: 2, y: 3 });
  expect(world.snapshot.completed).toEqual([]);
  world.setEnabled(true);
  world.dispatch({ type: 'MOVE_INTENT', payload: { direction: 'forward' } });
  clock = 5500;
  world.poll();
  clock = 10000;
  world.poll();
  expect(world.snapshot.completed).toEqual(['forward']);
  expect(world.snapshot.self.cell).toEqual({ x: 2, y: 2 });
});

it('requires the runner exit, ignores repeats and wrong keys, and never accepts an expired challenge', () => {
  let clock = 0;
  const world = createSoloWorld(() => clock);
  world.dispatch({ type: 'EXIT_START', payload: { exitId: 'solo-exit' } });
  expect(world.snapshot.self.challenge).toBeNull();
  world.lesson('runner');
  world.dispatch({ type: 'EXIT_START', payload: { exitId: 'solo-exit' } });
  const sequence = challengeKeys(world.snapshot.self.challenge!.challengeId);
  world.key(sequence[0]!, true);
  expect(world.snapshot.keyIndex).toBe(0);
  world.key(sequence[1]!);
  expect(world.snapshot.keyIndex).toBe(0);
  sequence.forEach((key) => world.key(key));
  expect(world.snapshot.completed).not.toContain('runner');
  clock = 1200;
  world.poll();
  expect(world.snapshot.completed).toContain('runner');
  const second = createSoloWorld(() => clock);
  second.lesson('runner');
  second.dispatch({ type: 'EXIT_START', payload: { exitId: 'solo-exit' } });
  clock += 10001;
  second.pose(1200);
  second.poll();
  expect(second.snapshot.completed).not.toContain('runner');
});

it('requires a complete pose hold or complete key sequence without mixing the two after a mode change', () => {
  let clock = 0;
  const world = createSoloWorld(() => clock);
  world.lesson('runner');
  world.dispatch({ type: 'EXIT_START', payload: { exitId: 'solo-exit' } });
  clock = 1200;
  world.pose(1199);
  expect(world.snapshot.completed).not.toContain('runner');
  const key = challengeKeys(world.snapshot.self.challenge!.challengeId)[0]!;
  world.key(key);
  world.clearChallengeProgress();
  expect(world.snapshot).toMatchObject({ keyIndex: 0, poseProgress: 0 });
  world.pose(1200);
  expect(world.snapshot.completed).toContain('runner');
});

it('requires a wall and stock for tagger installation, permits cancellation and clears role practice state', () => {
  let clock = 0;
  const world = createSoloWorld(() => clock);
  world.dispatch({ type: 'INSTALL', payload: { kind: 'trap' } });
  expect(world.snapshot.self.installation).toBeNull();
  world.lesson('tagger');
  world.dispatch({ type: 'INSTALL', payload: { kind: 'sensor' } });
  const id = world.snapshot.self.installation!.installationId;
  world.dispatch({ type: 'INSTALL_CANCEL', payload: { installationId: id } });
  clock = 501;
  world.poll();
  expect(world.snapshot.completed).not.toContain('tagger');
  world.dispatch({ type: 'INSTALL', payload: { kind: 'sensor' } });
  clock += 500;
  world.poll();
  expect(world.snapshot.completed).toContain('tagger');
  expect(world.snapshot.self.equipment.sensor).toBe(0);
  world.dispatch({ type: 'INSTALL', payload: { kind: 'sensor' } });
  expect(world.snapshot.self.installation).toBeNull();
  world.lesson('runner');
  expect(world.snapshot.self.ownedEquipment).toEqual([]);
  expect(world.snapshot.view.knownTerrain.filter((cell) => cell.kind === 'floor')).toHaveLength(15);
});
