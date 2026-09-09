import { describe, expect, it, vi } from 'vitest';
import {
  GenerationTransition,
  type GenerationTransitionDeps,
} from '../../src/media/GenerationTransition.js';
import { GrantIssuer, type GrantIssuerDeps } from '../../src/media/GrantIssuer.js';
import {
  MediaGenerationRegistry,
  type Generation,
} from '../../src/media/MediaGenerationRegistry.js';
import type { PolicyTimer } from '../../src/media/PolicyUncertainty.js';
import type {
  PreparationResult,
  PrepareGenerationRequest,
  RetirementResult,
  RetireGenerationRequest,
} from '../../src/media/types.js';
import {
  deferred,
  flush,
  localCapability,
  localConfiguration,
  practiceFrame,
  prepareRequest,
} from './generation-fixtures.js';

type Ready = Extract<PreparationResult, { status: 'ready' }>;

function setup() {
  let time = 100;
  let active = true;
  let allowed = true;
  const timers = new Set<{ callback: () => void; at: number }>();
  const timer: PolicyTimer = (callback, delay) => {
    const entry = { callback, at: time + delay };
    timers.add(entry);
    return () => timers.delete(entry);
  };
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe(practiceFrame);
  const rawRetire = vi.fn(async (input: RetireGenerationRequest): Promise<RetirementResult> => {
    const value = registry
      .all()
      .find(
        (g) =>
          g.request.matchId === input.matchId &&
          g.request.playerId === input.playerId &&
          g.request.mediaInstanceId === input.mediaInstanceId &&
          g.generation === input.receiverGeneration,
      );
    if (!value) return { ...input, status: 'unknown', code: 'STALE_GENERATION' };
    value.terminal = true;
    value.state = 'REVOKED';
    return { ...input, status: 'confirmed', code: null };
  });
  const issuerDeps: GrantIssuerDeps = {
    config: localConfiguration(1_800_000_000_000),
    registry,
    nowEpochMs: () => 1_800_000_000_000,
    canIssue: (generation) =>
      allowed &&
      (!generation ||
        transition.isAllowed(generation.request.matchId, generation.request.playerId)),
    capability: () => localCapability,
    reserve: vi.fn(async () => true),
    persist: vi.fn(async () => {}),
    retire: vi.fn((value) => {
      value.terminal = true;
      value.state = 'REVOKED';
    }),
    lock: vi.fn(),
    // Only the coordinator publishes the finally validated result.
    onPrepared: vi.fn(),
    sign: vi.fn(async () => 'synthetic-local-token'),
  };
  const issuer = new GrantIssuer(issuerDeps);
  const deps: GenerationTransitionDeps = {
    monotonicNow: () => time,
    timer,
    current: (input) => {
      const value = registry.get(input.matchId, input.playerId);
      if (!value) return null;
      return {
        requestId: `retire:${input.requestId}`,
        matchId: value.request.matchId,
        playerId: value.request.playerId,
        mediaInstanceId: value.request.mediaInstanceId,
        receiverGeneration: value.generation,
        reason:
          value.request.mediaInstanceId === input.mediaInstanceId ? 'reconnect' : 'phase-change',
      };
    },
    retire: rawRetire,
    prepare: vi.fn((input) => issuer.prepare(input)),
    isActive: (input) => active && registry.eligible(input),
    isCurrentScope: (input) => {
      const value = registry.get(input.matchId, input.playerId);
      return (
        value?.request.mediaInstanceId === input.mediaInstanceId &&
        value.generation === input.receiverGeneration
      );
    },
    validatePrepared: (result) => {
      const value = registry.get(result.matchId, result.playerId);
      return !!value && registry.isCurrent(value) && value.identity === result.grant.mediaIdentity;
    },
    discardPrepared: vi.fn(async (_result, input) => {
      await rawRetire({
        requestId: `discard:${input.requestId}`,
        matchId: input.matchId,
        playerId: input.playerId,
        mediaInstanceId: input.mediaInstanceId,
        receiverGeneration: (input.expectedPreviousGeneration ?? 0) + 1,
        reason: 'shutdown',
      });
    }),
    awaitLocalRetirement: vi.fn(async () => true),
    onBlocked: vi.fn(),
    onInvalidated: vi.fn((scope) => {
      const value = registry.get(scope.matchId, scope.playerId);
      if (value) value.terminal = true;
    }),
  };
  const transition = new GenerationTransition(deps);
  return {
    registry,
    deps,
    issuerDeps,
    rawRetire,
    transition,
    timers,
    setActive: (value: boolean) => {
      active = value;
    },
    setAllowed: (value: boolean) => {
      allowed = value;
    },
    setTime: (value: number, fire = false) => {
      time = value;
      if (fire) {
        for (const entry of [...timers]) {
          if (entry.at <= time) {
            timers.delete(entry);
            entry.callback();
          }
        }
      }
    },
    current: () => registry.get('m', 'p')!,
  };
}

const nextRequest: PrepareGenerationRequest = {
  ...prepareRequest,
  requestId: 'prepare-2',
  expectedPreviousGeneration: 1,
};
function retireRequest(generation: Generation, reason: RetireGenerationRequest['reason']) {
  return {
    requestId: `end:${reason}`,
    matchId: generation.request.matchId,
    playerId: generation.request.playerId,
    mediaInstanceId: generation.request.mediaInstanceId,
    receiverGeneration: generation.generation,
    reason,
  } satisfies RetireGenerationRequest;
}

describe('E-16 generation transition; real registry/issuer with synthetic remote retirement', () => {
  it('prepares an initial generation without requiring a prior browser retirement', async () => {
    const s = setup();
    const result = await s.transition.replace(prepareRequest);
    expect(result.status).toBe('ready');
    expect(result.receiverGeneration).toBe(1);
    expect(s.rawRetire).not.toHaveBeenCalled();
    expect(s.deps.awaitLocalRetirement).not.toHaveBeenCalled();
    expect(s.timers.size).toBe(0);
  });

  it('waits for remote confirmed then separate local retirement before allocating/signing', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const first = s.current();
    const remote = deferred<RetirementResult>();
    const local = deferred<boolean>();
    s.deps.retire = vi.fn(() => remote.promise);
    s.deps.awaitLocalRetirement = vi.fn(() => local.promise);
    const promise = s.transition.replace(nextRequest, { recovery: true });
    await flush();
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(1);
    expect(s.deps.awaitLocalRetirement).not.toHaveBeenCalled();
    first.terminal = true;
    first.state = 'REVOKED';
    remote.resolve({ ...s.deps.current(nextRequest)!, status: 'confirmed', code: null });
    await flush();
    expect(s.deps.awaitLocalRetirement).toHaveBeenCalledOnce();
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(1);
    local.resolve(true);
    const result = await promise;
    expect(result).toMatchObject({ status: 'ready', playerId: 'p', receiverGeneration: 2 });
    if (result.status !== 'ready') throw new Error('EXPECTED_READY');
    expect(result.grant.mediaIdentity).not.toBe(first.identity);
    expect(s.current().request.matchId).toBe(first.request.matchId);
    expect(s.timers.size).toBe(0);
  });

  it('keeps player ID but changes room and identity for practice to game', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const first = s.current();
    s.registry.observe({
      ...practiceFrame,
      mediaInstanceId: 'game',
      instancePurpose: 'game',
      phase: 'GAME_LOADING',
    });
    const result = await s.transition.replace({
      ...nextRequest,
      mediaInstanceId: 'game',
      purpose: 'game',
    });
    expect(result).toMatchObject({
      status: 'ready',
      playerId: 'p',
      receiverGeneration: 2,
      mediaInstanceId: 'game',
    });
    expect(s.current().roomName).not.toBe(first.roomName);
    expect(s.current().identity).not.toBe(first.identity);
    expect(s.rawRetire).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'phase-change', mediaInstanceId: 'practice' }),
    );
    expect(s.timers.size).toBe(0);
  });

  it.each([
    'unknown',
    'mismatched-request',
    'mismatched-match',
    'mismatched-player',
    'mismatched-instance',
    'mismatched-generation',
    'mismatched-reason',
  ])('does not sign a replacement after %s remote retirement', async (fault) => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    s.deps.retire = vi.fn(async (input) => {
      const value: RetirementResult = { ...input, status: 'confirmed', code: null };
      if (fault === 'unknown') return { ...input, status: 'unknown', code: 'TIMEOUT' };
      if (fault === 'mismatched-request') return { ...value, requestId: 'other' };
      if (fault === 'mismatched-match') return { ...value, matchId: 'other' };
      if (fault === 'mismatched-player') return { ...value, playerId: 'other' };
      if (fault === 'mismatched-instance') return { ...value, mediaInstanceId: 'other' };
      if (fault === 'mismatched-generation') return { ...value, receiverGeneration: 2 };
      return { ...value, reason: 'round-ended' };
    });
    expect(await s.transition.replace(nextRequest)).toMatchObject({
      status: 'unknown',
      grant: null,
      code: 'RETIREMENT_UNCONFIRMED',
    });
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(1);
    expect(s.deps.awaitLocalRetirement).not.toHaveBeenCalled();
    expect(s.deps.onBlocked).toHaveBeenCalledWith(nextRequest, 'RETIREMENT_UNCONFIRMED');
  });

  it.each(['absent', 'false', 'throw'])(
    'blocks a missing or failed D retirement acknowledgment: %s',
    async (kind) => {
      const s = setup();
      await s.transition.replace(prepareRequest);
      if (kind === 'absent') delete s.deps.awaitLocalRetirement;
      else
        s.deps.awaitLocalRetirement = async () => {
          if (kind === 'throw') throw new Error('local-disposal-failed');
          return false;
        };
      expect(await s.transition.replace(nextRequest)).toMatchObject({
        grant: null,
        code: 'RETIREMENT_UNCONFIRMED',
      });
      expect(s.registry.all()).toHaveLength(1);
    },
  );

  it('allows independent players concurrently but serializes duplicate and competing requests for one player', async () => {
    const s = setup();
    s.registry.observe({
      ...practiceFrame,
      frameRevision: 2,
      participants: ['p', 'q'].map((playerId) => ({ ...practiceFrame.participants[0]!, playerId })),
    });
    const firstSign = deferred<string>();
    s.issuerDeps.sign = vi.fn((g) =>
      g.request.playerId === 'p' ? firstSign.promise : Promise.resolve('synthetic-q'),
    );
    const first = s.transition.replace(prepareRequest);
    const duplicate = s.transition.replace(prepareRequest);
    const competing = s.transition.replace({ ...prepareRequest, requestId: 'competing' });
    const other = await s.transition.replace({
      ...prepareRequest,
      requestId: 'other',
      playerId: 'q',
    });
    expect(other.status).toBe('ready');
    expect(s.registry.all()).toHaveLength(2);
    firstSign.resolve('synthetic-p');
    expect((await first).status).toBe('ready');
    expect((await duplicate).status).toBe('ready');
    expect(await competing).toMatchObject({ code: 'STALE_GENERATION' });
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(2);
  });

  it('changes only the reconnecting player among six participants', async () => {
    const s = setup();
    const players = ['p', 'q', 'r', 's', 't', 'u'];
    s.registry.observe({
      ...practiceFrame,
      frameRevision: 2,
      participants: players.map((playerId) => ({ ...practiceFrame.participants[0]!, playerId })),
    });
    for (const playerId of players)
      await s.transition.replace({ ...prepareRequest, requestId: `initial-${playerId}`, playerId });
    const before = new Map(
      s.registry
        .all()
        .map((g) => [g.request.playerId, { identity: g.identity, generation: g.generation }]),
    );
    expect((await s.transition.replace(nextRequest, { recovery: true })).status).toBe('ready');
    for (const playerId of players.slice(1)) {
      const current = s.registry.get('m', playerId)!;
      expect({ identity: current.identity, generation: current.generation }).toEqual(
        before.get(playerId),
      );
    }
    expect(s.current().generation).toBe(2);
  });

  it('rejects old cached grants and input reuse after a replacement', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    await s.transition.replace(nextRequest);
    expect(await s.transition.replace(prepareRequest)).toMatchObject({
      code: 'STALE_GENERATION',
      grant: null,
    });
    expect(await s.transition.replace({ ...nextRequest, mediaInstanceId: 'other' })).toMatchObject({
      code: 'WRONG_SCOPE',
    });
    expect(s.registry.all()).toHaveLength(2);
  });

  it('allows an allocation-free NOT_READY retry after the real issuance gate opens', async () => {
    const s = setup();
    s.setAllowed(false);
    expect(await s.transition.replace(prepareRequest)).toMatchObject({
      code: 'NOT_READY',
      receiverGeneration: null,
    });
    s.setAllowed(true);
    expect((await s.transition.replace(prepareRequest)).status).toBe('ready');
    expect(s.registry.all()).toHaveLength(1);
  });

  it.each([
    'personal-ended',
    'connection-lost',
    'policy-unknown',
    'round-ended',
    'shutdown',
  ] as const)('synchronously seals issuance on %s while signing is pending', async (reason) => {
    const s = setup();
    const sign = deferred<string>();
    s.issuerDeps.sign = () => sign.promise;
    const pending = s.transition.replace(prepareRequest);
    await flush();
    const retirement = s.transition.retire(retireRequest(s.current(), reason));
    expect(s.transition.isAllowed('m', 'p')).toBe(false);
    expect(await pending).toMatchObject({
      grant: null,
      code: reason === 'policy-unknown' ? 'POLICY_UNKNOWN' : 'STALE_GENERATION',
    });
    sign.resolve('too-late-synthetic');
    expect((await retirement).status).toBe('confirmed');
    expect(s.current().terminal).toBe(true);
    expect(await s.transition.replace(nextRequest)).toMatchObject({ code: 'STALE_GENERATION' });
  });

  it('does not let an old personal-ended retirement terminate the replacement', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const old = s.current();
    await s.transition.replace(nextRequest);
    expect((await s.transition.retire(retireRequest(old, 'personal-ended'))).status).toBe(
      'confirmed',
    );
    expect(s.transition.isAllowed('m', 'p')).toBe(true);
    expect(s.registry.isCurrent(s.current())).toBe(true);
    expect(s.current().generation).toBe(2);
  });

  it('uses a fresh logical match after round-ended without reopening the old one', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    await s.transition.retire(retireRequest(s.current(), 'round-ended'));
    s.registry.observe({ ...practiceFrame, matchId: 'next-match' });
    expect(
      (
        await s.transition.replace({
          ...prepareRequest,
          requestId: 'next-match-prepare',
          matchId: 'next-match',
        })
      ).status,
    ).toBe('ready');
    expect(s.transition.isAllowed('m', 'p')).toBe(false);
    expect(s.registry.get('next-match', 'p')!.generation).toBe(1);
  });

  it('times out only ordinary recovery, aborts local acknowledgment, and prevents late grants', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    let signal!: AbortSignal;
    const local = deferred<boolean>();
    s.deps.awaitLocalRetirement = (_input, value) => {
      signal = value;
      return local.promise;
    };
    const pending = s.transition.replace(nextRequest, { recovery: true });
    await flush();
    s.setTime(10_099, true);
    expect(signal.aborted).toBe(false);
    s.setTime(10_101, true);
    expect(await pending).toMatchObject({ code: 'TIMEOUT', grant: null });
    expect(signal.aborted).toBe(true);
    expect(s.transition.isAllowed('m', 'p')).toBe(false);
    expect(s.deps.onBlocked).toHaveBeenCalledWith(nextRequest, 'TIMEOUT');
    local.resolve(true);
    await flush();
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(1);
  });

  it('checks monotonic deadline when a late response beats a delayed timer', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const local = deferred<boolean>();
    s.deps.awaitLocalRetirement = () => local.promise;
    const pending = s.transition.replace(nextRequest, { recovery: true });
    await flush();
    s.setTime(10_101);
    local.resolve(true);
    expect(await pending).toMatchObject({ code: 'TIMEOUT' });
    expect(s.registry.all()).toHaveLength(1);
  });

  it('keeps only the remaining two seconds after eight seconds of ordinary recovery', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    s.setTime(8100);
    const local = deferred<boolean>();
    s.deps.awaitLocalRetirement = () => local.promise;
    const pending = s.transition.replace(nextRequest, { recovery: true, recoveryStartedAt: 100 });
    await flush();
    s.setTime(10_101, true);
    expect(await pending).toMatchObject({ code: 'TIMEOUT', grant: null });
    local.resolve(true);
    await flush();
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(1);
  });

  it.each([101, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid or future recovery start %s without issuing',
    async (recoveryStartedAt) => {
      const s = setup();
      expect(
        await s.transition.replace(prepareRequest, { recovery: true, recoveryStartedAt }),
      ).toMatchObject({ code: 'TIMEOUT', grant: null });
      expect(s.issuerDeps.sign).not.toHaveBeenCalled();
    },
  );

  it('rearms an early timer instead of expiring an active recovery early', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const local = deferred<boolean>();
    s.deps.awaitLocalRetirement = () => local.promise;
    const pending = s.transition.replace(nextRequest, { recovery: true });
    await flush();
    const early = [...s.timers][0]!;
    s.timers.delete(early);
    early.callback();
    expect(s.deps.onBlocked).not.toHaveBeenCalled();
    local.resolve(true);
    expect((await pending).status).toBe('ready');
  });

  it('ends immediately for POLICY_UNKNOWN without waiting for the recovery timer', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const local = deferred<boolean>();
    s.deps.awaitLocalRetirement = () => local.promise;
    const pending = s.transition.replace(nextRequest, { recovery: true });
    await flush();
    s.transition.invalidatePlayer('m', 'p', 'policy-unknown');
    expect(await pending).toMatchObject({ code: 'POLICY_UNKNOWN', grant: null });
    expect(s.timers.size).toBe(0);
    local.resolve(true);
    await flush();
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(1);
  });

  it('checks a game connection lost during remote retirement before invoking the issuer', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const remote = deferred<RetirementResult>();
    s.deps.retire = () => remote.promise;
    const pending = s.transition.replace(nextRequest);
    await flush();
    s.setActive(false);
    remote.resolve({ ...s.deps.current(nextRequest)!, status: 'confirmed', code: null });
    expect(await pending).toMatchObject({ code: 'STALE_GENERATION' });
    expect(s.issuerDeps.sign).toHaveBeenCalledTimes(1);
  });

  it('cancels close immediately and cleans a producer that returns a late ready result', async () => {
    const s = setup();
    const prepared = deferred<PreparationResult>();
    const raw = s.deps.prepare;
    const result = await raw(prepareRequest);
    if (result.status !== 'ready') throw new Error('EXPECTED_READY');
    // A deliberately faulty/stalled producer bypasses the issuer's own end checks.
    s.deps.current = () => null;
    s.deps.prepare = () => prepared.promise;
    const pending = s.transition.replace(prepareRequest);
    await flush();
    s.transition.close();
    expect(await pending).toMatchObject({ code: 'STALE_GENERATION' });
    prepared.resolve(result);
    await flush();
    expect(s.deps.discardPrepared).toHaveBeenCalledWith(result, prepareRequest);
    expect(s.current().state).toBe('REVOKED');
    expect(await s.transition.replace(nextRequest)).toMatchObject({ code: 'STALE_GENERATION' });
  });

  it.each([
    'requestId',
    'matchId',
    'playerId',
    'mediaInstanceId',
    'receiverGeneration',
    'grantScope',
    'identity',
  ])('discards a malformed or stale prepared %s result', async (field) => {
    const s = setup();
    const raw = s.deps.prepare;
    s.deps.prepare = async (input) => {
      const result = await raw(input);
      if (result.status !== 'ready') throw new Error('EXPECTED_READY');
      if (field === 'receiverGeneration') return { ...result, receiverGeneration: 77 };
      if (field === 'grantScope')
        return { ...result, grant: { ...result.grant, matchId: 'old-match' } };
      if (field === 'identity')
        return { ...result, grant: { ...result.grant, mediaIdentity: 'old-identity' } };
      return { ...result, [field]: 'old-value' } as Ready;
    };
    expect(await s.transition.replace(prepareRequest)).toMatchObject({
      code: 'STALE_GENERATION',
      grant: null,
    });
    expect(s.deps.discardPrepared).toHaveBeenCalledOnce();
    expect(s.current().state).toBe('REVOKED');
  });

  it('freezes cached results and captures request input before asynchronous work', async () => {
    const s = setup();
    const input = { ...prepareRequest };
    const promise = s.transition.replace(input);
    input.playerId = 'modified';
    const result = await promise;
    expect(result).toMatchObject({ status: 'ready', playerId: 'p' });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status === 'ready') expect(Object.isFrozen(result.grant)).toBe(true);
  });

  it('idempotently retires one request and rejects request ID reuse across action/body', async () => {
    const s = setup();
    await s.transition.replace(prepareRequest);
    const input = retireRequest(s.current(), 'round-ended');
    const one = s.transition.retire(input);
    expect(s.transition.retire(input)).toBe(one);
    expect((await one).status).toBe('confirmed');
    expect(s.rawRetire).toHaveBeenCalledOnce();
    expect(await s.transition.retire({ ...input, receiverGeneration: 2 })).toMatchObject({
      code: 'WRONG_SCOPE',
    });
    expect(
      await s.transition.retire({ ...input, requestId: prepareRequest.requestId }),
    ).toMatchObject({ code: 'WRONG_SCOPE' });
  });
});
