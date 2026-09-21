import { expect, it } from 'vitest';
import { resolveAvatarState, roleAssetRequest } from './role-avatar-state';

const runner = { role: 'runner' as const };
const hidden = { role: undefined };

it('never selects a role asset when the server omitted the role', () => {
  expect(roleAssetRequest(hidden)).toBeNull();
  expect(resolveAvatarState(hidden, { status: 'ready', role: 'runner' })).toBe('neutral');
});

it('uses the neutral silhouette while loading or after fallback', () => {
  expect(resolveAvatarState(runner, { status: 'loading' })).toBe('neutral');
  expect(resolveAvatarState(runner, { status: 'fallback' })).toBe('neutral');
});

it('renders only a ready asset matching the server-published role', () => {
  expect(resolveAvatarState(runner, { status: 'ready', role: 'runner' })).toBe('runner');
  expect(resolveAvatarState(runner, { status: 'ready', role: 'tagger' })).toBe('neutral');
  expect(roleAssetRequest(runner)).toBe('runner');
});
