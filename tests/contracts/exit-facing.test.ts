import { expect, it } from 'vitest';
import {
  facesExit,
  exitCandidate,
} from '../../apps/web/src/features/game/pose/challenge-controller';
import { viewFixture } from '../../apps/web/src/features/room/product-fixture';
import { startedMatch, step, command } from '../../packages/game-core/test/match/match-fixture';
import { exitOfOwner } from '../../packages/game-core/src/match/exits/registry';
import {
  getPlayerSelf,
  getVisibleSurfaces,
  getPlayerKnowledge,
} from '../../packages/game-core/src/match/engine';

it.each([0, 1, 2, 3] as const)(
  'agrees with the real core about EXIT_START facing direction %i',
  (dir) => {
    let state = startedMatch();
    const exit = exitOfOwner(state.exits, 'r-a')!;
    const players = new Map(state.players);
    players.set('r-a', { ...players.get('r-a')!, cell: exit.approach, dir });
    state = step({ ...state, players }, 101).state;
    const view = viewFixture({
      self: getPlayerSelf(state, 'r-a'),
      ...getVisibleSurfaces(state, 'r-a'),
      ...getPlayerKnowledge(state, 'r-a'),
    });
    const outcome = step(state, 102, [command('r-a', 'EXIT_START', { exitId: exit.exitId })])
      .outcomes[0]!;
    const canStart = exitCandidate(view) !== null && facesExit(view.self, exit);
    expect(canStart).toBe(outcome.result === 'applied');
    expect(canStart).toBe(dir === (exit.wall.side + 2) % 4);
  },
);
