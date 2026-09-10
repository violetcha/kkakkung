import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { exchangePresenter, permitsExchange } from './exchange-presenter';
it('selects only visible allies by distance/id and preserves an eligible selection', () => {
  const view = viewFixture({
    visibleEntities: ['b', 'a', 'enemy'].map((id) => ({
      id,
      kind: 'player',
      role: id === 'enemy' ? 'tagger' : 'runner',
      cell: { x: 2, y: 1 },
      dir: 0,
      action: null,
    })),
  });
  expect(exchangePresenter(view, null, 0)?.selected).toBe('a');
  expect(exchangePresenter(view, 'b', 0)?.selected).toBe('b');
  expect(
    permitsExchange(view, { type: 'EXCHANGE_REQUEST', payload: { targetPlayerId: 'enemy' } }),
  ).toBe(false);
  expect(exchangePresenter(view, 'enemy', 0)?.candidates).toHaveLength(2);
});
it('rejects outgoing acceptance and stale IDs without modifying knowledge', () => {
  const view = viewFixture();
  if (view.self?.status !== 'ACTIVE') throw Error();
  const outgoing = {
    ...view,
    self: {
      ...view.self,
      exchange: {
        exchangeId: 'current',
        fromPlayerId: 'self',
        toPlayerId: 'ally',
        direction: 'outgoing' as const,
        expiresAtTick: 40,
      },
    },
  };
  expect(
    permitsExchange(outgoing, { type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'current' } }),
  ).toBe(false);
  const incoming = {
    ...outgoing,
    self: {
      ...outgoing.self,
      exchange: {
        ...outgoing.self.exchange,
        fromPlayerId: 'ally',
        toPlayerId: 'self',
        direction: 'incoming' as const,
      },
    },
  };
  expect(
    permitsExchange(incoming, { type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'current' } }),
  ).toBe(true);
  expect(
    permitsExchange(incoming, { type: 'EXCHANGE_CANCEL', payload: { exchangeId: 'old' } }),
  ).toBe(false);
  expect(exchangePresenter(incoming, null, 50)?.exchange?.exchangeId).toBe('current');
  expect(incoming.mapVersion).toBe(view.mapVersion);
});
