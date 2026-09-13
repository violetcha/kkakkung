import { mediaGrantSchema } from '@kkakkung/protocol/game-messages';
import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it, vi } from 'vitest';
import { GrantIssuer, type GrantIssuerDeps } from '../../src/media/GrantIssuer.js';
import { parseCapabilityReport } from '../../src/media/CloudCapabilityProbe.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { ownedMediaTargets } from '../../src/operations/SplitMediaOwnership.js';
import { SPLIT_AUTHORITY_CHECKS } from '../../src/media/SplitCapability.js';
import { deferred, flush, localConfiguration, prepareRequest } from './generation-fixtures.js';
import { localSplitCapability, splitPracticeFrame } from './split-fixtures.js';

function setup() {
  let now = Date.now();
  let allowed = true;
  const registry = new MediaGenerationRegistry('e-fixture', false, 'split');
  registry.observe(splitPracticeFrame);
  const capability = localSplitCapability(now);
  const deps: GrantIssuerDeps = {
    config: {
      ...localConfiguration(now),
      subscriptionMode: 'server-forwarding',
      maxConcurrentParticipants: 100,
    },
    registry,
    nowEpochMs: () => now,
    canIssue: () => allowed,
    capability: () => capability,
    reserve: vi.fn(async () => true),
    persist: vi.fn(async () => {}),
    retire: vi.fn((generation) => {
      generation.terminal = true;
    }),
    lock: vi.fn(),
    onPrepared: vi.fn(),
  };
  const issuer = new GrantIssuer(deps);
  const request = (index = 0) => ({
    ...prepareRequest,
    requestId: `prepare-${index}`,
    playerId: `p${index}`,
  });
  return {
    deps,
    registry,
    issuer,
    request,
    deny: () => {
      allowed = false;
    },
    advance: (ms: number) => {
      now += ms;
    },
    capability,
  };
}

describe('split grant producer with actual JWT signing and public schema; local only', () => {
  it('issues six complete pairs in seven stable rooms with source-specific claims and one expiry', async () => {
    const s = setup();
    const grants = await Promise.all(
      Array.from({ length: 6 }, (_, index) => s.issuer.prepare(s.request(index))),
    );
    const rooms = new Set<string>();
    const identities = new Set<string>();
    const tokens = new Set<string>();
    const verify = new TokenVerifier(s.deps.config.apiKey, s.deps.config.apiSecret);
    for (const result of grants) {
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') throw new Error('EXPECTED_PAIR');
      const grant = mediaGrantSchema.parse(result.grant);
      const face = grant.facePublication!;
      const voiceClaims = await verify.verify(grant.token);
      const faceClaims = await verify.verify(face.token);
      expect(voiceClaims).toMatchObject({
        sub: grant.mediaIdentity,
        exp: grant.expiresAt,
        video: {
          room: grant.roomName,
          canSubscribe: true,
          canPublishSources: ['microphone'],
          canPublishData: false,
          roomAdmin: false,
        },
      });
      expect(faceClaims).toMatchObject({
        sub: face.mediaIdentity,
        exp: grant.expiresAt,
        video: {
          room: face.roomName,
          canSubscribe: false,
          canPublishSources: ['camera'],
          canPublishData: false,
          roomAdmin: false,
        },
      });
      rooms.add(grant.roomName).add(face.roomName);
      identities.add(grant.mediaIdentity).add(face.mediaIdentity);
      tokens.add(grant.token).add(face.token);
      const generation = s.registry.get(result.matchId, result.playerId)!;
      expect(ownedMediaTargets(generation)).toHaveLength(12);
      expect(generation.splitOwnership!.receiverRoomNames).toHaveLength(5);
      expect(Object.isFrozen(generation.splitOwnership!.receiverRoomNames)).toBe(true);
    }
    expect(rooms.size).toBe(7);
    expect(identities.size).toBe(12);
    expect(tokens.size).toBe(12);
    expect(s.registry.retained.rooms).toBe(7);
    expect(s.deps.reserve).toHaveBeenCalledTimes(6);
    expect(s.deps.persist).toHaveBeenCalledTimes(6);
    for (const generation of s.registry.all()) {
      expect(new Set(generation.splitOwnership!.receiverRoomNames)).toEqual(
        new Set(
          s.registry
            .all()
            .filter((other) => other !== generation)
            .map((other) => other.roomName),
        ),
      );
      expect(JSON.stringify(generation)).not.toContain('eyJ');
    }
  });

  it('does not sign either token before the complete ownership persist resolves', async () => {
    const s = setup();
    const gate = deferred<void>();
    s.deps.persist = () => gate.promise;
    s.deps.sign = vi.fn(async (_generation, publication) => `synthetic-${publication}`);
    const result = s.issuer.prepare(s.request());
    await flush();
    expect(s.registry.all()[0]?.splitOwnership?.receiverRoomNames).toHaveLength(5);
    expect(s.deps.sign).not.toHaveBeenCalled();
    gate.resolve();
    expect((await result).status).toBe('ready');
    expect(vi.mocked(s.deps.sign).mock.calls.map(([, publication]) => publication)).toEqual([
      'receiver',
      'face',
    ]);
  });

  it('retires the complete ownership when the second signing fails without exposing the first token', async () => {
    const s = setup();
    s.deps.sign = vi.fn(async (_generation, publication) => {
      if (publication === 'face') throw new Error('signing-failure');
      return 'synthetic-first';
    });
    expect(await s.issuer.prepare(s.request())).toMatchObject({ status: 'unknown', grant: null });
    expect(s.registry.all()[0]?.state).toBe('UNRESOLVED');
    expect(s.deps.retire).toHaveBeenCalledOnce();
    expect(s.deps.onPrepared).not.toHaveBeenCalled();
    expect(ownedMediaTargets(s.registry.all()[0]!)).toHaveLength(12);
  });

  it('does not sign the face leg after a late first token loses admission', async () => {
    const s = setup();
    const gate = deferred<string>();
    s.deps.sign = vi.fn(() => gate.promise);
    const result = s.issuer.prepare(s.request());
    await flush();
    s.deny();
    gate.resolve('synthetic-late');
    expect(await result).toMatchObject({
      status: 'rejected',
      code: 'STALE_GENERATION',
      grant: null,
    });
    expect(s.deps.sign).toHaveBeenCalledOnce();
    expect(s.deps.retire).toHaveBeenCalledOnce();
  });

  it('rechecks capability and shared expiry after both signing operations', async () => {
    const s = setup();
    s.deps.sign = vi.fn(async (_generation, publication) => {
      if (publication === 'face') s.advance(300001);
      return `synthetic-${publication}`;
    });
    expect(await s.issuer.prepare(s.request())).toMatchObject({
      status: 'rejected',
      code: 'STALE_GENERATION',
      grant: null,
    });
    expect(s.deps.onPrepared).not.toHaveBeenCalled();
  });

  it.each(SPLIT_AUTHORITY_CHECKS)(
    'rejects missing actual-boundary flag %s before allocation or signing',
    async (key) => {
      const s = setup();
      s.deps.capability = () => ({
        ...s.capability,
        splitAuthorityProof: { ...s.capability.splitAuthorityProof!, [key]: false },
      });
      expect(await s.issuer.prepare(s.request())).toMatchObject({
        code: 'NOT_READY',
        receiverGeneration: null,
        grant: null,
      });
      expect(s.registry.all()).toHaveLength(0);
      expect(s.deps.reserve).not.toHaveBeenCalled();
    },
  );

  it('rejects privilege widening and relabeling an old shared-source report as split authority', () => {
    const profile = localSplitCapability();
    expect(() =>
      parseCapabilityReport({
        ...profile,
        splitGrantProfile: {
          ...profile.splitGrantProfile,
          face: { ...profile.splitGrantProfile!.face, canSubscribe: true },
        },
      }),
    ).toThrow();
    expect(() =>
      parseCapabilityReport({
        ...profile,
        splitGrantProfile: {
          ...profile.splitGrantProfile,
          receiver: {
            ...profile.splitGrantProfile!.receiver,
            canPublishSources: ['camera', 'microphone'],
          },
        },
      }),
    ).toThrow();
    expect(() => parseCapabilityReport({ ...profile, splitAuthorityProof: undefined })).toThrow();
    expect(() =>
      parseCapabilityReport({ ...profile, subscriptionMode: 'publisher-permissions' }),
    ).toThrow();
  });

  it('retains a fixed roster and private rooms across a valid replacement but rejects new actors', async () => {
    const s = setup();
    const first = await s.issuer.prepare(s.request());
    expect(first.status).toBe('ready');
    const old = s.registry.all()[0]!;
    old.terminal = true;
    old.state = 'REVOKED';
    const next = await s.issuer.prepare({
      ...s.request(),
      requestId: 'replacement',
      expectedPreviousGeneration: 1,
    });
    expect(next.status).toBe('ready');
    const current = s.registry.get('m', 'p0')!;
    expect(current.roomName).toBe(old.roomName);
    expect(current.splitOwnership!.faceRoomName).toBe(old.splitOwnership!.faceRoomName);
    expect(current.identity).not.toBe(old.identity);
    expect(current.splitOwnership!.faceIdentity).not.toBe(old.splitOwnership!.faceIdentity);
    expect(
      s.registry.observe({
        ...splitPracticeFrame,
        frameRevision: 2,
        participants: [{ ...splitPracticeFrame.participants[0]!, playerId: 'foreign' }],
      }),
    ).toBe(false);
    s.registry.endMatch('m');
    expect(s.registry.retained.rooms).toBe(0);
  });
});
