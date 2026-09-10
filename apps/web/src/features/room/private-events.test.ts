import { expect, it, vi } from 'vitest';
import { createPrivateEvents } from './private-events';
import { viewFixture } from './product-fixture';
import type { PrivateEvent } from '@kkakkung/protocol/game-messages';
const event = (serial = 1, overrides: Partial<PrivateEvent> = {}): PrivateEvent =>
  ({
    matchId: 'm',
    gameScope: viewFixture().gameScope as PrivateEvent['gameScope'],
    eventId: `m:10:${serial}`,
    tick: 10,
    stateVersion: 11,
    type: 'EXCHANGE_COMPLETED',
    payload: { exchangeId: 'exchange', mapVersion: 2 },
    ...overrides,
  }) as PrivateEvent;
function setup() {
  let now = 0;
  const apply = vi.fn();
  const resync = vi.fn();
  const queue = createPrivateEvents({ now: () => now, apply, resync });
  queue.update(viewFixture(), 'm');
  return {
    queue,
    apply,
    resync,
    time: (value: number) => {
      now = value;
    },
  };
}
it('waits for the matching view and deduplicates delivery', () => {
  const f = setup();
  f.queue.receive(event());
  f.queue.receive(event());
  expect(f.queue.pendingCount).toBe(1);
  expect(f.apply).not.toHaveBeenCalled();
  f.queue.update(viewFixture({ stateVersion: 11 }), 'm');
  f.queue.receive(event());
  expect(f.apply).toHaveBeenCalledTimes(1);
  expect(f.queue.pendingCount).toBe(0);
});
it('bounds future scopes to 64 items and one second with rate limited resync', () => {
  const f = setup();
  for (let i = 0; i < 65; i++) f.queue.receive(event(i));
  expect(f.queue.pendingCount).toBe(0);
  expect(f.resync).toHaveBeenCalledTimes(1);
  f.queue.receive(event(66));
  f.time(1000);
  f.queue.poll();
  expect(f.queue.pendingCount).toBe(0);
  expect(f.resync).toHaveBeenCalledTimes(2);
});
it('rejects old and conflicting scopes and never promotes a scope from an event', () => {
  const f = setup();
  f.queue.receive(
    event(1, { gameScope: { kind: 'practice', gameInstanceId: 'old', revision: 1 } }),
  );
  f.queue.receive(event(2, { gameScope: { kind: 'game', gameInstanceId: 'wrong', revision: 3 } }));
  f.queue.receive(event(3, { gameScope: { kind: 'game', gameInstanceId: 'next', revision: 5 } }));
  f.queue.update(
    viewFixture({ self: null, gameScope: { kind: 'none', gameInstanceId: null, revision: 4 } }),
    'm',
  );
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.queue.pendingCount).toBe(1);
  f.queue.update(
    viewFixture({
      stateVersion: 12,
      gameScope: { kind: 'game', gameInstanceId: 'next', revision: 5 },
    }),
    'm',
  );
  expect(f.apply).toHaveBeenCalledTimes(1);
  f.queue.clear();
  f.queue.receive(event(4));
  expect(f.queue.pendingCount).toBe(0);
});
