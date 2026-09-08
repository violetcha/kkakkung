import { describe, expect, it } from 'vitest';

import { createContextStore, type InteractionContext } from './interaction-context';

const base: InteractionContext = {
  matchId: 'match-1',
  selfPlayerId: 'runner-1',
  role: 'runner',
  phase: 'PLAYING',
  status: 'ACTIVE',
  mode: 'motion',
  pageActive: true,
};

describe('createContextStore', () => {
  it('reports no invalidation for the very first context', () => {
    const store = createContextStore();

    const change = store.set(base);

    expect(change.shouldClearHolds).toBe(false);
    expect(store.get()).toEqual(base);
    expect(store.acceptsInput).toBe(true);
  });

  it('clears holds when the match changes', () => {
    const store = createContextStore();
    store.set(base);

    const change = store.set({ ...base, matchId: 'match-2' });

    expect(change.matchChanged).toBe(true);
    expect(change.shouldClearHolds).toBe(true);
  });

  it('clears holds when an exchange id disappears or the direction flips', () => {
    const store = createContextStore();
    store.set({ ...base, incomingExchangeId: 'exchange-1' });

    const gone = store.set(base);
    expect(gone.exchangeInvalidated).toBe(true);

    store.set({ ...base, incomingExchangeId: 'exchange-2' });
    const flipped = store.set({ ...base, outgoingExchangeId: 'exchange-2' });
    expect(flipped.exchangeInvalidated).toBe(true);
    expect(flipped.shouldClearHolds).toBe(true);
  });

  it('clears holds when the challenge or the installation id changes', () => {
    const store = createContextStore();
    store.set({ ...base, challengeId: 'challenge-1', installationId: 'install-1' });

    const change = store.set(base);

    expect(change.challengeInvalidated).toBe(true);
    expect(change.installationInvalidated).toBe(true);
  });

  it('locks the input when the page goes inactive or the player is no longer active', () => {
    const store = createContextStore();
    store.set(base);

    const hidden = store.set({ ...base, pageActive: false });
    expect(hidden.inputLocked).toBe(true);
    expect(store.acceptsInput).toBe(false);

    store.set(base);
    const escaped = store.set({ ...base, status: 'ESCAPED' });
    expect(escaped.inputLocked).toBe(true);
    expect(store.acceptsInput).toBe(false);
  });

  it('accepts input only in the active play phases', () => {
    const store = createContextStore();

    store.set({ ...base, phase: 'LOBBY' });
    expect(store.acceptsInput).toBe(false);

    store.set({ ...base, phase: 'TEAM_PRACTICE' });
    expect(store.acceptsInput).toBe(true);

    store.set({ ...base, phase: 'RESULT' });
    expect(store.acceptsInput).toBe(false);
  });

  it('marks a role or mode change as a hold invalidation', () => {
    const store = createContextStore();
    store.set(base);

    expect(store.set({ ...base, role: 'tagger' }).roleChanged).toBe(true);
    expect(store.set({ ...base, role: 'tagger', mode: 'keyboard' }).modeChanged).toBe(true);
  });

  it('reports the challenge state for the action blockers', () => {
    const store = createContextStore();
    store.set(base);
    expect(store.inChallenge).toBe(false);

    store.set({ ...base, challengeId: 'challenge-1' });
    expect(store.inChallenge).toBe(true);
  });

  it('carries no item slot or item command field', () => {
    const store = createContextStore();
    store.set(base);

    const keys = Object.keys(store.get()!);
    expect(keys).not.toContain('items');
    expect(keys).not.toContain('inventory');
    expect(keys).not.toContain('itemSlot');
  });

  it('forgets everything on clear', () => {
    const store = createContextStore();
    store.set(base);

    store.clear();

    expect(store.get()).toBeNull();
    expect(store.acceptsInput).toBe(false);
    expect(store.inChallenge).toBe(false);
  });
});
