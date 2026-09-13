import { expect, it } from 'vitest';
import { getFrame } from '../../packages/game-core/src/match/engine.js';
import type { CoreCommand } from '../../packages/game-core/src/match/core-types.js';
import {
  command,
  createTestPractice,
  step,
} from '../../packages/game-core/test/match/match-fixture.js';
import { AudibilityPolicy } from '../../server/src/media/AudibilityPolicy.js';
import { practiceFrame } from '../../server/test/media/generation-fixtures.js';
import { DeploymentPracticeApproach } from '../cloud/DeploymentPracticeApproach.js';

it('waits for publications and applied outcomes, bounds outstanding inputs and ignores duplicate ACKs', () => {
  const approach = new DeploymentPracticeApproach(6);
  let count = 0;
  const send = () => `r-${++count}`;
  expect(approach.advance(false, send)).toBe(0);
  expect(count).toBe(0);
  expect(approach.advance(true, send)).toBe(6);
  expect(approach.advance(true, send)).toBe(0);
  approach.acknowledge('r-1', 'rejected');
  expect(approach.advance(true, send)).toBe(1);
  approach.acknowledge('r-1', 'applied');
  expect(approach.snapshot()[0]).toBe(0);
  approach.acknowledge('r-7', 'applied');
  approach.acknowledge('r-7', 'applied');
  expect(approach.snapshot()[0]).toBe(1);
});

it.each(['runner', 'tagger'] as const)(
  'uses real %s practice movements to reach actual spatial voice permission',
  (role) => {
    const ids = ['player-1', 'player-3', 'player-5'];
    let state = createTestPractice(role, ids);
    const approach = new DeploymentPracticeApproach(3);
    const acoustic = new AudibilityPolicy();
    let audioAllowed = false;
    for (let tick = 1; tick <= 180; tick++) {
      const inputs: CoreCommand[] = [];
      if (tick % 2 === 0)
        approach.advance(tick >= 40, (index) => {
          const input = command(ids[index]!, 'MOVE_INTENT', { direction: 'forward' });
          inputs.push(input);
          return input.requestId;
        });
      const result = step(state, tick, inputs);
      state = result.state;
      for (const outcome of result.outcomes)
        approach.acknowledge(outcome.requestId, outcome.result);
      const frame = getFrame(state);
      const audio = acoustic.observe({
        ...practiceFrame,
        frameRevision: tick,
        tick,
        topology: state.layout.topology,
        participants: frame.participants,
      });
      if (tick < 40) expect(approach.snapshot()).toEqual([0, 0, 0]);
      audioAllowed ||= audio!.receivers.some((receiver) =>
        receiver.voices.some((voice) => voice.gain > 0),
      );
    }
    expect(approach.snapshot()).toEqual([3, 3, 3]);
    expect(audioAllowed).toBe(true);
    expect(
      approach.advance(true, () => {
        throw new Error('TOO_MANY_INPUTS');
      }),
    ).toBe(0);
  },
);
