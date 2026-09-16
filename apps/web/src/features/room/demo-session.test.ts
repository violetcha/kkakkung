/**
 * S15P21C204-260. The operator demo entry: a complete fragment opens a session and is cleared
 * from the address, and anything incomplete opens nothing at all.
 */
import { expect, it, vi } from 'vitest';
import { consumeDemoSession } from './product-session';

const place = (hash: string) => ({ hash, pathname: '/play', search: '' });

it('takes the demo session out of the address and clears the fragment', () => {
  const history = { replaceState: vi.fn() };
  const session = consumeDemoSession(
    place('#demo=operator-token&room=ABCDEF&player=operator-1'),
    history,
  );
  expect(session).toMatchObject({
    sessionToken: 'operator-token',
    roomCode: 'ABCDEF',
    playerId: 'operator-1',
    protocolVersion: '0.2.0',
  });
  // The token never stays in the address bar or the history entry.
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/play');
});

it.each([
  ['no fragment', ''],
  ['an invitation', '#invite=token&room=ABCDEF'],
  ['a missing player', '#demo=token&room=ABCDEF'],
  ['a missing room', '#demo=token&player=operator-1'],
  ['a malformed room', '#demo=token&room=abc&player=operator-1'],
])('opens nothing for %s', (_case, hash) => {
  const history = { replaceState: vi.fn() };
  expect(consumeDemoSession(place(hash), history)).toBeNull();
  expect(history.replaceState).not.toHaveBeenCalled();
});
