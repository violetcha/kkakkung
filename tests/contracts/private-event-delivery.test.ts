import { expect, it } from 'vitest';
import { privateEventSchema, type PrivateEvent } from '@kkakkung/protocol/game-messages';
import { matchCore } from '../../packages/game-core/src/match/engine.js';
import {
  command,
  player,
  startedMatch,
  step,
} from '../../packages/game-core/test/match/match-fixture.js';
import { EventDispatcher } from '../../server/src/game/EventDispatcher.js';
import { MatchContext } from '../../server/src/game/MatchContext.js';
import { projectPrivateBody } from '../../server/src/game/PlayerProjection.js';
import { createPrivateEvents } from '../../apps/web/src/features/room/private-events.js';

it('applies actual core exchange and hunter events exactly once across server projection and web consumption', () => {
  let state = startedMatch(100);
  const placed = new Map(state.players);
  placed.set('r-a', { ...player(state, 'r-a'), cell: { x: 10, y: 2 }, dir: 1 });
  placed.set('r-b', { ...player(state, 'r-b'), cell: { x: 11, y: 2 }, dir: 3 });
  state = { ...state, players: placed };
  const context = new MatchContext({
    serverEpoch: 'fixture',
    matchId: state.matchId,
    createId: () => state.gameInstanceId,
  });
  context.createInstance('game');
  const received: { id: string; event: PrivateEvent }[] = [];
  const applied: { id: string; event: PrivateEvent }[] = [];
  const resyncs: string[] = [];
  const clients = new Map(
    state.order.map((id) => [
      id,
      createPrivateEvents({
        now: () => 0,
        apply: (event) => applied.push({ id, event }),
        resync: () => resyncs.push(id),
      }),
    ]),
  );
  for (const id of state.order) context.enterInstance(id, state.gameInstanceId);
  const dispatcher = new EventDispatcher({
    context,
    now: () => 0,
    viewBody: (id) => projectPrivateBody(matchCore, state, id, null),
    sender: {
      sendView: (id, view) => clients.get(id)!.update(view, state.matchId),
      sendEvent: (id, event) => {
        expect(privateEventSchema.safeParse(event).success).toBe(true);
        received.push({ id, event });
        clients.get(id)!.receive(event);
      },
      sendOutcome() {},
      sendStatus() {},
    },
  });
  const commit = (result: ReturnType<typeof step>) => {
    state = result.state;
    for (const id of state.order) dispatcher.publishView(id, 'change', 'PLAYING');
    for (const event of result.events)
      if (event.type !== 'SPATIAL_SOUND') dispatcher.dispatchEvent(event, state.gameInstanceId);
  };
  commit(step(state, 101, [command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' })]));
  expect(state.exchanges.size).toBe(1);
  commit(step(state, 102, [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })]));
  expect(state.exchanges.size).toBe(0);
  commit(step(state, 122));
  expect(received.filter((item) => item.event.type === 'EXCHANGE_COMPLETED')).toHaveLength(2);
  expect(received.filter((item) => item.event.type === 'HUNTER_MARKER')).toHaveLength(3);
  expect(received.every((item) => item.event.eventId.startsWith('match-1/game-1/'))).toBe(true);
  expect(applied).toEqual(received);
  for (const item of received) clients.get(item.id)!.receive(item.event);
  expect(applied).toEqual(received);
  expect(resyncs).toEqual([]);
});
