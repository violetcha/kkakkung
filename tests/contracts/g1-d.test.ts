// F-09 / QA-04 G1-D on E's real RetirementBarrier + SubscriptionController + GenerationRegistry
// + GrantIssuer/GenerationTransition: a personal end arrives while an allow for the same
// identity is still in flight. RemoveParticipant and the late allow are settled in every order;
// the identity stays terminal, an unconfirmed removal stays UNRESOLVED with its reservation, and a
// retired player cannot obtain a new grant under a new generation. Cloud half (old token rejected
// by LiveKit, direct setSubscribed refused): tests/cloud/g1-d.cloud.test.ts, BLOCKED until F-02.
import { describe, expect, it, vi } from 'vitest';
import {
  GenerationTransition,
  type GenerationTransitionDeps,
} from '../../server/src/media/GenerationTransition.ts';
import { GrantIssuer } from '../../server/src/media/GrantIssuer.ts';
import {
  EPOCH_MS,
  barrierHarness,
  capability,
  configuration,
  flush,
  prepareRequest,
  receiverKey,
  registryWith,
  retireRequest,
  subscriptionHarness,
} from '../fixtures/media-recovery-scenarios.ts';

describe('G1-D: retirement racing an in-flight allow', () => {
  it('Remove first: the identity is REVOKED and a late allow response changes nothing', async () => {
    const { registry, generation } = registryWith(['r1', 't1']);
    const g = generation('r1');
    const subs = subscriptionHarness();
    const key = receiverKey('r1', g);
    subs.desire(key, 10, ['A']);
    await flush();
    const allow = subs.dispatched()[0]!;
    // B's personal end: permissions stop, then the remote removal runs and completes first.
    const b = barrierHarness(registry, [g]);
    subs.controller.retire(key);
    const retirement = b.barrier.retire(retireRequest(g, 'personal-ended'));
    await flush();
    expect(g.terminal).toBe(true);
    expect(b.stopped).toEqual([g.identity]);
    expect(b.persisted).toEqual([{ identity: g.identity, state: 'REVOKING' }]);
    expect(b.removes[0]).toMatchObject({
      identity: g.identity,
      cutoff: BigInt(Math.floor(EPOCH_MS / 1000) + 2),
    });
    b.removes[0]!.resolve();
    await flush();
    b.absents[0]!.resolve(true);
    expect(await retirement).toMatchObject({
      status: 'confirmed',
      code: null,
      reason: 'personal-ended',
    });
    expect(g.state).toBe('REVOKED');
    expect(b.confirmed).toEqual([g.identity]);
    // Now the old allow answers: late, consumed, no acknowledgement, no new request.
    allow.resolve();
    await flush();
    expect(subs.late).toEqual([
      { requestId: allow.requestId, receiverGeneration: 1, outcome: 'resolved' },
    ]);
    expect(subs.controller.inspect(key)).toMatchObject({ terminal: true, acknowledgedTracks: [] });
    expect(subs.dispatched()).toHaveLength(1);
    // A second retire request with another id shares the confirmed result; nothing runs twice.
    expect(
      await b.barrier.retire(retireRequest(g, 'personal-ended', 'retire-again')),
    ).toMatchObject({ status: 'confirmed' });
    expect(b.removes).toHaveLength(1);
  });

  it('late allow first: an acknowledged subscription is torn down by the removal, permissions stop before the remote call', async () => {
    const { registry, generation } = registryWith(['r1']);
    const g = generation('r1');
    const subs = subscriptionHarness();
    const key = receiverKey('r1', g);
    subs.desire(key, 10, ['A']);
    await flush();
    subs.dispatched()[0]!.resolve();
    await flush();
    expect(subs.controller.inspect(key)?.acknowledgedTracks).toEqual(['A']);
    const b = barrierHarness(registry, [g]);
    const order: string[] = [];
    const retirement = b.barrier.retire(retireRequest(g, 'personal-ended'));
    order.push(...b.stopped.map(() => 'stopPermissions'));
    await flush();
    order.push(...b.removes.map(() => 'remove'));
    expect(order).toEqual(['stopPermissions', 'remove']);
    subs.controller.retire(key);
    b.removes[0]!.resolve();
    await flush();
    b.absents[0]!.resolve(true);
    expect(await retirement).toMatchObject({ status: 'confirmed' });
    expect(g.state).toBe('REVOKED');
    expect(subs.controller.inspect(key)?.terminal).toBe(true);
  });

  it('Remove acknowledged but absence unconfirmed: UNRESOLVED, terminal, reservation kept, retry allowed only explicitly', async () => {
    const { registry, generation } = registryWith(['r1']);
    const g = generation('r1');
    const b = barrierHarness(registry, [g]);
    const first = b.barrier.retire(retireRequest(g, 'personal-ended', 'retire-1'));
    await flush();
    b.removes[0]!.resolve();
    await flush();
    // The participant is still listed after the acknowledged removal: not confirmed.
    b.absents[0]!.resolve(false);
    expect(await first).toMatchObject({ status: 'unknown', code: 'RETIREMENT_UNCONFIRMED' });
    expect(g.state).toBe('UNRESOLVED');
    expect(g.terminal).toBe(true);
    expect(b.unresolved).toEqual([g.identity]);
    expect(b.persisted.map((p) => p.state)).toEqual(['REVOKING', 'UNRESOLVED']);
    expect(b.confirmed).toEqual([]);
    // The reservation is not released by an unknown result: the registry still holds the generation.
    expect(registry.get('m', 'r1')).toBe(g);
    // A plain repeat with a new request id does not re-run the remote call; an explicit retry does.
    expect(await b.barrier.retire(retireRequest(g, 'personal-ended', 'retire-2'))).toMatchObject({
      status: 'unknown',
      code: 'RETIREMENT_UNCONFIRMED',
    });
    expect(b.removes).toHaveLength(1);
    const retry = b.barrier.retire(retireRequest(g, 'personal-ended', 'retire-3'), true);
    await flush();
    expect(b.removes).toHaveLength(2);
    b.removes[1]!.resolve();
    await flush();
    b.absents[1]!.resolve(true);
    expect(await retry).toMatchObject({ status: 'confirmed' });
    expect(g.state).toBe('REVOKED');
  });

  it('a retired player cannot get a new grant: unresolved → RETIREMENT_UNCONFIRMED, ended → no issue under a new generation', async () => {
    const { registry, generation } = registryWith(['r1', 'r2']);
    const g = generation('r1');
    g.terminal = true;
    g.state = 'UNRESOLVED';
    const transition = new GenerationTransition({
      monotonicNow: () => 0,
      current: () => null,
      retire: vi.fn(),
      prepare: vi.fn(),
      isActive: () => true,
      isCurrentScope: () => true,
      validatePrepared: () => true,
      discardPrepared: () => undefined,
      onBlocked: () => undefined,
    } satisfies GenerationTransitionDeps);
    const reserve = vi.fn(async () => true);
    const sign = vi.fn(async () => 'synthetic-token');
    const issuer = new GrantIssuer({
      config: configuration(),
      registry,
      nowEpochMs: () => EPOCH_MS,
      canIssue: (existing) =>
        !existing || transition.isAllowed(existing.request.matchId, existing.request.playerId),
      capability: () => capability,
      reserve,
      persist: async () => undefined,
      retire: (value) => {
        value.terminal = true;
        value.state = 'REVOKED';
      },
      lock: () => undefined,
      onPrepared: () => undefined,
      sign,
    });
    // The unresolved identity blocks its player: no new generation is minted on top of it.
    expect(
      await issuer.prepare(
        prepareRequest('r1', { requestId: 'p-r1-next', expectedPreviousGeneration: 1 }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'RETIREMENT_UNCONFIRMED' });
    expect(reserve).not.toHaveBeenCalled();
    // Once revoked, the personal end (B → transition) still forbids a new generation for r1.
    g.state = 'REVOKED';
    transition.invalidatePlayer('m', 'r1', 'personal-ended');
    expect(transition.isAllowed('m', 'r1')).toBe(false);
    const ended = await issuer.prepare(
      prepareRequest('r1', { requestId: 'p-r1-after-end', expectedPreviousGeneration: 1 }),
    );
    expect(ended.status).toBe('rejected');
    expect(registry.get('m', 'r1')?.state).toBe('REVOKED');
    expect(sign).not.toHaveBeenCalled();
    // Another player's generation is untouched and still current.
    expect(transition.isAllowed('m', 'r2')).toBe(true);
    expect(registry.isCurrent(generation('r2'))).toBe(true);
  });

  it('a new identity for another player is never touched by the old identity’s late response', async () => {
    const { generation } = registryWith(['r1', 'r2']);
    const subs = subscriptionHarness();
    const k1 = receiverKey('r1', generation('r1'));
    const k2 = receiverKey('r2', generation('r2'));
    subs.desire(k1, 10, ['A']);
    subs.desire(k2, 10, ['B']);
    await flush();
    expect(subs.dispatched()).toHaveLength(2);
    const [allow1, allow2] = subs.dispatched();
    subs.controller.retire(k1);
    allow2!.resolve();
    await flush();
    allow1!.resolve();
    await flush();
    expect(subs.controller.inspect(k2)).toMatchObject({
      acknowledgedTracks: ['B'],
      terminal: false,
    });
    expect(subs.controller.inspect(k1)).toMatchObject({ acknowledgedTracks: [], terminal: true });
    expect(subs.late.map((l) => l.requestId)).toEqual([allow1!.requestId]);
    subs.controller.dispose();
  });
});
