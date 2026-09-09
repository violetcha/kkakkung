import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it, vi } from 'vitest';
import { GrantIssuer, type GrantIssuerDeps } from '../../src/media/GrantIssuer.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import {
  deferred,
  flush,
  localCapability,
  localConfiguration,
  practiceFrame,
  prepareRequest,
} from './generation-fixtures.js';

function setup() {
  let now = Date.now();
  let allowed = true;
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe(practiceFrame);
  const deps: GrantIssuerDeps = {
    config: localConfiguration(now),
    registry,
    nowEpochMs: () => now,
    canIssue: () => allowed,
    capability: () => localCapability,
    reserve: vi.fn(async () => true),
    persist: vi.fn(async () => {}),
    retire: vi.fn((g) => {
      g.terminal = true;
    }),
    lock: vi.fn(),
    onPrepared: vi.fn(),
  };
  const issuer = new GrantIssuer(deps);
  return {
    deps,
    registry,
    issuer,
    time: (value: number) => {
      now = value;
    },
    deny: () => {
      allowed = false;
    },
    allow: () => {
      allowed = true;
    },
    now: () => now,
  };
}

describe('journal-before-sign generation issuance; local SDK verification only', () => {
  it('rechecks a pre-allocation NOT_READY under the same stable request ID without allowing payload reuse', async () => {
    const s = setup();
    s.deny();
    expect(await s.issuer.prepare(prepareRequest)).toMatchObject({
      code: 'NOT_READY',
      receiverGeneration: null,
    });
    expect(s.registry.all()).toHaveLength(0);
    expect(await s.issuer.prepare({ ...prepareRequest, playerId: 'other' })).toMatchObject({
      code: 'WRONG_SCOPE',
    });
    s.allow();
    const [first, duplicate] = await Promise.all([
      s.issuer.prepare(prepareRequest),
      s.issuer.prepare(prepareRequest),
    ]);
    expect(first.status).toBe('ready');
    expect(duplicate.status).toBe('ready');
    expect(s.registry.all()).toHaveLength(1);
    expect(s.deps.reserve).toHaveBeenCalledOnce();
    expect(s.deps.persist).toHaveBeenCalledOnce();
  });
  it('merges duplicate authenticated requests, records once and verifies actual minimum JWT claims', async () => {
    const s = setup();
    const [one, two] = await Promise.all([
      s.issuer.prepare(prepareRequest),
      s.issuer.prepare(prepareRequest),
    ]);
    expect(one).toEqual(two);
    expect(one.status).toBe('ready');
    expect(s.deps.reserve).toHaveBeenCalledOnce();
    expect(s.deps.persist).toHaveBeenCalledOnce();
    if (one.status !== 'ready') throw new Error('EXPECTED_READY');
    const claims = await new TokenVerifier(s.deps.config.apiKey, s.deps.config.apiSecret).verify(
      one.grant.token,
    );
    expect(claims.sub).toBe(one.grant.mediaIdentity);
    expect(claims.exp).toBe(one.grant.expiresAt);
    expect(claims.video).toEqual({
      roomJoin: true,
      room: one.grant.roomName,
      canPublishData: false,
      canSubscribe: false,
      canPublishSources: ['camera', 'microphone'],
      roomAdmin: false,
      roomRecord: false,
      roomCreate: false,
      roomList: false,
    });
    expect(one.grant.expiresAt).toBe(Math.floor(s.registry.all()[0]!.expiresAtEpochMs / 1000));
    expect(JSON.stringify(s.registry.all())).not.toContain(one.grant.token);
  });
  it('never signs before durable PREPARED completion and locks failed storage', async () => {
    const s = setup();
    const disk = deferred<void>();
    s.deps.persist = vi.fn(() => disk.promise);
    s.deps.sign = vi.fn(async () => 'local-token');
    const pending = s.issuer.prepare(prepareRequest);
    await flush();
    expect(s.deps.sign).not.toHaveBeenCalled();
    disk.reject(new Error('fsync failed'));
    expect(await pending).toMatchObject({ status: 'unknown', grant: null });
    expect(s.deps.sign).not.toHaveBeenCalled();
    expect(s.deps.lock).toHaveBeenCalled();
    expect(s.registry.all()[0]!.terminal).toBe(true);
  });
  it('refuses terminal state or window closure while signing and retires the tracked identity', async () => {
    const s = setup();
    const sign = deferred<string>();
    s.deps.sign = () => sign.promise;
    const pending = s.issuer.prepare(prepareRequest);
    await flush();
    s.deny();
    sign.resolve('local-token');
    expect(await pending).toMatchObject({
      status: 'rejected',
      grant: null,
      code: 'STALE_GENERATION',
    });
    expect(s.deps.retire).toHaveBeenCalledOnce();
  });
  it('rejects readiness, wrong practice scope, stale generation and request ID conflicts without signing', async () => {
    const s = setup();
    s.deps.sign = vi.fn(async () => 'local-token');
    s.deny();
    const denied = await s.issuer.prepare(prepareRequest);
    expect(denied).toEqual({
      requestId: 'prepare-1',
      matchId: 'm',
      playerId: 'p',
      mediaInstanceId: 'practice',
      status: 'rejected',
      receiverGeneration: null,
      grant: null,
      code: 'NOT_READY',
    });
    expect(await s.issuer.prepare({ ...prepareRequest, mediaInstanceId: 'other' })).toMatchObject({
      code: 'WRONG_SCOPE',
    });
    expect(s.deps.reserve).not.toHaveBeenCalled();
    expect(s.deps.sign).not.toHaveBeenCalled();
    const ready = setup();
    expect(
      await ready.issuer.prepare({ ...prepareRequest, expectedPreviousGeneration: 99 }),
    ).toMatchObject({ code: 'STALE_GENERATION' });
    expect(
      await ready.issuer.prepare({ ...prepareRequest, requestId: 'new', mediaInstanceId: 'other' }),
    ).toMatchObject({ code: 'WRONG_SCOPE' });
  });
  it('does not return cached old token after a newer generation replaces it', async () => {
    const s = setup();
    s.deps.sign = async (g) => `synthetic-generation-${g.generation}`;
    const old = await s.issuer.prepare(prepareRequest);
    expect(old.status).toBe('ready');
    const generation = s.registry.all()[0]!;
    generation.terminal = true;
    generation.state = 'REVOKED';
    const current = await s.issuer.prepare({
      ...prepareRequest,
      requestId: 'prepare-2',
      expectedPreviousGeneration: 1,
    });
    expect(current).toMatchObject({ status: 'ready', receiverGeneration: 2 });
    expect(await s.issuer.prepare(prepareRequest)).toMatchObject({
      status: 'rejected',
      code: 'STALE_GENERATION',
      grant: null,
    });
    expect(s.registry.all()[1]!.identity).not.toBe(generation.identity);
  });
  it('revalidates capacity excluding its own allocated generation and rejects expired cached grants', async () => {
    const s = setup();
    s.deps.canIssue = (own) =>
      s.registry.all().filter((g) => g !== own && g.state !== 'REVOKED').length < 1;
    expect(await s.issuer.prepare(prepareRequest)).toMatchObject({ status: 'ready' });
    s.time(s.now() + 300_001);
    expect(await s.issuer.prepare(prepareRequest)).toMatchObject({ code: 'STALE_GENERATION' });
  });
  it('rejects a first grant when signing crosses the JWT whole-second expiry', async () => {
    const s = setup();
    s.time(Math.floor(s.now() / 1000) * 1000 + 500);
    s.deps.sign = async (generation) => {
      s.time(Math.floor(generation.expiresAtEpochMs / 1000) * 1000 + 1);
      return 'synthetic-expired-token';
    };
    expect(await s.issuer.prepare(prepareRequest)).toMatchObject({
      status: 'rejected',
      code: 'STALE_GENERATION',
      grant: null,
    });
    expect(s.deps.retire).toHaveBeenCalledOnce();
    expect(s.deps.onPrepared).not.toHaveBeenCalled();
  });
  it('does not allocate a new match while the player still has an unretired previous match', async () => {
    const s = setup();
    await s.issuer.prepare(prepareRequest);
    s.registry.observe({ ...practiceFrame, matchId: 'next-match' });
    expect(
      await s.issuer.prepare({ ...prepareRequest, requestId: 'next', matchId: 'next-match' }),
    ).toMatchObject({ code: 'RETIREMENT_UNCONFIRMED' });
  });
  it('invalidates old practice scope permanently after the authoritative game scope arrives', () => {
    const s = setup();
    expect(s.registry.eligible(prepareRequest)).toBe(true);
    s.registry.observe({
      ...practiceFrame,
      mediaInstanceId: 'game',
      instancePurpose: 'game',
      phase: 'GAME_LOADING',
    });
    expect(s.registry.eligible(prepareRequest)).toBe(false);
    s.registry.observe({ ...practiceFrame, frameRevision: 500 });
    expect(s.registry.eligible(prepareRequest)).toBe(false);
    expect(
      s.registry.eligible({ ...prepareRequest, mediaInstanceId: 'game', purpose: 'game' }),
    ).toBe(true);
  });
  it('keeps simultaneous disjoint practice teams eligible and cannot allocate after close', () => {
    const s = setup();
    s.registry.observe({
      ...practiceFrame,
      mediaInstanceId: 'other-team',
      participants: [{ ...practiceFrame.participants[0]!, playerId: 'p2', role: 'tagger' }],
    });
    expect(s.registry.eligible(prepareRequest)).toBe(true);
    s.registry.close();
    expect(() => s.registry.allocate(prepareRequest, s.now())).toThrow('WRONG_SCOPE');
  });
});
