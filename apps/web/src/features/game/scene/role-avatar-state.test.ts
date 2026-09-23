import { expect, it } from 'vitest';
import { resolveAvatarState, roleAssetRequest } from './role-avatar-state';

const runner = { role: 'runner' as const };
const hidden = { role: undefined };

it('infers an omitted enemy role from the observer role', () => {
  expect(roleAssetRequest(hidden, 'tagger')).toBe('runner');
  expect(roleAssetRequest(hidden, 'runner')).toBe('tagger');
  expect(resolveAvatarState(hidden, { status: 'ready', role: 'runner' }, 'tagger')).toBe('runner');
});

it('keeps an omitted role neutral when there is no observer role to infer from', () => {
  expect(roleAssetRequest(hidden, null)).toBeNull();
  expect(resolveAvatarState(hidden, { status: 'ready', role: 'runner' }, null)).toBe('neutral');
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
