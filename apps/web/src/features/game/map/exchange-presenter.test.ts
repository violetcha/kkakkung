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
  expect(
    permitsExchange(incoming, { type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'current' } }, 40),
  ).toBe(false);
});

it('limits requests to adjacent runners and blocks restraint while preserving cancel', () => {
  const view = viewFixture({
    visibleEntities: [
      { id: 'near', kind: 'player', role: 'runner', cell: { x: 2, y: 1 }, dir: 0, action: null },
      { id: 'far', kind: 'player', role: 'runner', cell: { x: 3, y: 1 }, dir: 0, action: null },
      {
        id: 'diagonal',
        kind: 'player',
        role: 'runner',
        cell: { x: 2, y: 2 },
        dir: 0,
        action: null,
      },
    ],
  });
  if (view.self?.status !== 'ACTIVE') throw Error();
  expect(exchangePresenter(view, null, 10)?.candidates.map((p) => p.id)).toEqual(['near']);
  expect(
    exchangePresenter({ ...view, self: { ...view.self, role: 'tagger' } }, null, 10),
  ).toBeNull();
  const restrained = { ...view, self: { ...view.self, restraintUntilTick: 20 } };
  expect(
    permitsExchange(
      restrained,
      { type: 'EXCHANGE_REQUEST', payload: { targetPlayerId: 'near' } },
      19,
    ),
  ).toBe(false);
  expect(
    permitsExchange(
      restrained,
      { type: 'EXCHANGE_REQUEST', payload: { targetPlayerId: 'near' } },
      20,
    ),
  ).toBe(true);
  const pending = {
    ...restrained,
    self: {
      ...restrained.self,
      exchange: {
        exchangeId: 'x',
        fromPlayerId: 'near',
        toPlayerId: 'self',
        direction: 'incoming' as const,
        expiresAtTick: 30,
      },
    },
  };
  expect(
    permitsExchange(pending, { type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'x' } }, 19),
  ).toBe(false);
  expect(
    permitsExchange(pending, { type: 'EXCHANGE_CANCEL', payload: { exchangeId: 'x' } }, 19),
  ).toBe(true);
});
