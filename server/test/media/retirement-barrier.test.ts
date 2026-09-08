import { describe, expect, it, vi } from 'vitest';
import {
  RetirementBarrier,
  type RetirementBarrierDeps,
} from '../../src/media/RetirementBarrier.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import type { RetireGenerationRequest } from '../../src/media/types.js';
import {
  deferred,
  flush,
  localCapability,
  practiceFrame,
  prepareRequest,
} from './generation-fixtures.js';

const input: RetireGenerationRequest = {
  requestId: 'retire-1',
  matchId: 'm',
  playerId: 'p',
  mediaInstanceId: 'practice',
  receiverGeneration: 1,
  reason: 'phase-change',
};
function setup() {
  let now = 1_800_000_000;
  const registry = new MediaGenerationRegistry('e-fixture');
  registry.observe(practiceFrame);
  const generation = registry.allocate(prepareRequest, now * 1000);
  const states: string[] = [];
  const deps: RetirementBarrierDeps = {
    find: () => generation,
    capability: () => localCapability,
    nowEpochSeconds: () => now,
    persist: vi.fn(async (g) => {
      states.push(g.state);
    }),
    stopPermissions: vi.fn(),
    remove: vi.fn(async () => {}),
    absent: vi.fn(async () => true),
    onUnresolved: vi.fn(),
    onConfirmed: vi.fn(async () => {}),
  };
  return {
    generation,
    deps,
    states,
    barrier: new RetirementBarrier(deps),
    time: (value: number) => {
      now = value;
    },
  };
}
describe('remote retirement barrier; local fault injection only', () => {
  it('attempts the first cleanup of an issuance failure already marked terminal and unresolved', async () => {
    const s = setup();
    s.generation.terminal = true;
    s.generation.state = 'UNRESOLVED';
    const disk = deferred<void>();
    s.deps.persist = vi.fn(async (generation) => {
      s.states.push(generation.state);
      if (generation.state === 'REVOKING') await disk.promise;
    });
    const pending = s.barrier.retire(input);
    expect(s.barrier.retire(input)).toBe(pending);
    expect(s.deps.stopPermissions).toHaveBeenCalledOnce();
    expect(s.deps.remove).not.toHaveBeenCalled();
    disk.resolve();
    expect(await pending).toMatchObject({ status: 'confirmed' });
    expect(s.deps.remove).toHaveBeenCalledOnce();
    expect(s.states).toEqual(['REVOKING', 'REVOKED']);
  });
  it('sets terminal synchronously, returns identical duplicate Promise and persists before remote revoke', async () => {
    const s = setup();
    const disk = deferred<void>();
    s.deps.persist = vi.fn(async (g) => {
      s.states.push(g.state);
      if (g.state === 'REVOKING') await disk.promise;
    });
    const pending = s.barrier.retire(input);
    expect(s.barrier.retire(input)).toBe(pending);
    expect(s.generation.terminal).toBe(true);
    expect(s.deps.stopPermissions).toHaveBeenCalledOnce();
    expect(s.deps.remove).not.toHaveBeenCalled();
    disk.resolve();
    expect(await pending).toMatchObject({ status: 'confirmed' });
    expect(s.deps.remove).toHaveBeenCalledOnce();
    expect(s.states).toEqual(['REVOKING', 'REVOKED']);
    expect(s.deps.remove).toHaveBeenCalledWith(s.generation, 1_800_000_002n);
  });
  it('shares remote cleanup across different request IDs but keeps each result scoped', async () => {
    const s = setup();
    const one = s.barrier.retire(input);
    const two = s.barrier.retire({ ...input, requestId: 'retire-2' });
    expect((await one).requestId).toBe('retire-1');
    expect((await two).requestId).toBe('retire-2');
    expect(s.deps.remove).toHaveBeenCalledOnce();
    expect(await s.barrier.retire({ ...input, playerId: 'wrong' })).toMatchObject({
      code: 'STALE_GENERATION',
    });
  });
  it('keeps never-joined removal errors unresolved instead of inferring revocation from absence', async () => {
    const s = setup();
    s.deps.remove = vi.fn(async () => {
      throw Object.assign(new Error('absent'), { code: 'not_found' });
    });
    expect(await s.barrier.retire(input)).toMatchObject({
      status: 'unknown',
      code: 'RETIREMENT_UNCONFIRMED',
    });
    expect(s.deps.absent).not.toHaveBeenCalled();
    expect(s.deps.onConfirmed).not.toHaveBeenCalled();
    expect(s.generation.state).toBe('UNRESOLVED');
  });
  it.each(['timeout', '429'])(
    'does not release reservations after %s and requires explicit retry',
    async (error) => {
      const s = setup();
      s.deps.remove = vi.fn(async () => {
        throw new Error(error);
      });
      expect((await s.barrier.retire(input)).status).toBe('unknown');
      expect((await s.barrier.retire({ ...input, requestId: 'second' })).status).toBe('unknown');
      expect(s.deps.remove).toHaveBeenCalledOnce();
      expect(s.deps.onConfirmed).not.toHaveBeenCalled();
      s.deps.remove = vi.fn(async () => {});
      s.time(1_800_000_005);
      expect((await s.barrier.retire(input, true)).status).toBe('confirmed');
      expect(s.deps.remove).toHaveBeenCalledWith(s.generation, 1_800_000_007n);
    },
  );
  it('rejects missing capability and unverified clock profiles before issuing revoke', async () => {
    const s = setup();
    s.deps.capability = () => null;
    expect((await s.barrier.retire(input)).status).toBe('unknown');
    expect(s.deps.remove).not.toHaveBeenCalled();
    const bad = setup();
    bad.deps.capability = () => ({
      ...localCapability,
      revocationProfile: {
        mode: 'explicit-cutoff',
        bufferSeconds: 60,
        maxObservedClockOffsetMs: 0,
      },
    });
    expect((await bad.barrier.retire(input)).status).toBe('unknown');
    expect(bad.deps.remove).not.toHaveBeenCalled();
  });
  it('preserves the proven SDK default revocation mode and requires participant absence', async () => {
    const s = setup();
    s.deps.capability = () => ({
      ...localCapability,
      revocationProfile: { mode: 'sdk-default', bufferSeconds: 2, maxObservedClockOffsetMs: 100 },
    });
    s.deps.absent = async () => false;
    expect((await s.barrier.retire(input)).status).toBe('unknown');
    expect(s.deps.remove).toHaveBeenCalledWith(s.generation, undefined);
    expect(s.deps.onConfirmed).not.toHaveBeenCalled();
  });
  it('waits for durable REVOKED and room cleanup, and handles observer errors safely', async () => {
    const s = setup();
    const finalDisk = deferred<void>();
    s.deps.persist = async (g) => {
      if (g.state === 'REVOKED') await finalDisk.promise;
    };
    const done = vi.fn();
    const pending = s.barrier.retire(input);
    void pending.then(done);
    await flush();
    expect(done).not.toHaveBeenCalled();
    finalDisk.reject(new Error('final fsync failed'));
    s.deps.onUnresolved = () => {
      throw new Error('observer failed');
    };
    expect((await pending).status).toBe('unknown');
    expect(s.deps.onConfirmed).not.toHaveBeenCalled();
    expect(s.generation.state).toBe('UNRESOLVED');
  });
});
