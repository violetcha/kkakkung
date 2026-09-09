import { describe, expect, it, vi } from 'vitest';
import type { CapabilityReport, RevocationProfile } from '../../src/media/CloudCapabilityProbe.js';
import { GatewayError } from '../../src/media/LiveKitGateway.js';
import {
  confirmRemoteRevocation,
  type RemoteRevocationOptions,
} from '../../src/media/RemoteRevocation.js';
import { deferred, localCapability } from './generation-fixtures.js';

function setup() {
  const capability = vi.fn((): CapabilityReport | null => localCapability);
  const remove = vi.fn(async (_cutoff?: bigint) => {});
  const absent = vi.fn(async () => true);
  const options: RemoteRevocationOptions = {
    capability,
    nowEpochSeconds: () => 1_800_000_000.9,
    remove,
    absent,
  };
  return { options, capability, remove, absent };
}

describe('shared remote revocation confirmation; local callbacks only', () => {
  it('waits for the acknowledged removal before checking absence and applies the proven cutoff', async () => {
    const s = setup();
    const acknowledgment = deferred<void>();
    s.remove.mockImplementation(() => acknowledgment.promise);
    const pending = confirmRemoteRevocation(s.options);
    expect(s.remove).toHaveBeenCalledExactlyOnceWith(1_800_000_002n);
    expect(s.absent).not.toHaveBeenCalled();
    acknowledgment.resolve();
    await expect(pending).resolves.toBeUndefined();
    expect(s.absent).toHaveBeenCalledOnce();
  });

  it('leaves the cutoff unset for the verified SDK default revocation mode', async () => {
    const s = setup();
    s.capability.mockReturnValue({
      ...localCapability,
      revocationProfile: { mode: 'sdk-default', bufferSeconds: 2, maxObservedClockOffsetMs: 100 },
    });
    await confirmRemoteRevocation(s.options);
    expect(s.remove).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(s.absent).toHaveBeenCalledOnce();
  });

  it.each([
    new GatewayError('not_found', 404, false),
    new GatewayError('resource_exhausted', 429, false, 12_000),
    new GatewayError('deadline_exceeded', 504, true),
  ])(
    'preserves removal errors and retry hints without inferring success from absence: $code',
    async (error) => {
      const s = setup();
      s.remove.mockRejectedValue(error);
      await expect(confirmRemoteRevocation(s.options)).rejects.toBe(error);
      expect(s.absent).not.toHaveBeenCalled();
    },
  );

  it('requires positive absence confirmation even after successful removal', async () => {
    const s = setup();
    s.absent.mockResolvedValue(false);
    await expect(confirmRemoteRevocation(s.options)).rejects.toThrow('PARTICIPANT_REMAINS');
    expect(s.remove).toHaveBeenCalledOnce();
  });

  it('propagates absence lookup errors without converting a 404 into confirmation', async () => {
    const s = setup();
    const error = new GatewayError('not_found', 404, false);
    s.absent.mockRejectedValue(error);
    await expect(confirmRemoteRevocation(s.options)).rejects.toBe(error);
    expect(s.remove).toHaveBeenCalledOnce();
  });

  it.each<CapabilityReport | null>([
    null,
    { ...localCapability, status: 'BLOCKED' },
    { ...localCapability, revocationProfile: null },
    { ...localCapability, revocationVerified: false },
  ])(
    'rejects unavailable or unverified capability before any remote side effect',
    async (report) => {
      const s = setup();
      s.capability.mockReturnValue(report);
      await expect(confirmRemoteRevocation(s.options)).rejects.toThrow('CAPABILITY_UNVERIFIED');
      expect(s.remove).not.toHaveBeenCalled();
      expect(s.absent).not.toHaveBeenCalled();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid clock before removal: %s',
    async (now) => {
      const s = setup();
      s.options.nowEpochSeconds = () => now;
      await expect(confirmRemoteRevocation(s.options)).rejects.toThrow('INVALID_CLOCK');
      expect(s.remove).not.toHaveBeenCalled();
      expect(s.absent).not.toHaveBeenCalled();
    },
  );

  it.each<Pick<RevocationProfile, 'bufferSeconds' | 'maxObservedClockOffsetMs'>>([
    { bufferSeconds: -1, maxObservedClockOffsetMs: 0 },
    { bufferSeconds: 0.5, maxObservedClockOffsetMs: 0 },
    { bufferSeconds: Number.NaN, maxObservedClockOffsetMs: 0 },
    { bufferSeconds: 2, maxObservedClockOffsetMs: -1 },
    { bufferSeconds: 2, maxObservedClockOffsetMs: Number.POSITIVE_INFINITY },
    { bufferSeconds: 60, maxObservedClockOffsetMs: 0 },
    { bufferSeconds: 59, maxObservedClockOffsetMs: 1_000 },
  ])('rejects an invalid or exhausted Cloud clock window: %j', async (window) => {
    const s = setup();
    s.capability.mockReturnValue({
      ...localCapability,
      revocationProfile: { mode: 'explicit-cutoff', ...window },
    });
    await expect(confirmRemoteRevocation(s.options)).rejects.toThrow('INVALID_CLOCK');
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.absent).not.toHaveBeenCalled();
  });

  it('blocks all work when already closed and exposes only a fixed cancellation reason', async () => {
    const s = setup();
    s.options.beforeDispatch = () => false;
    await expect(confirmRemoteRevocation(s.options)).rejects.toThrow('REMOTE_REVOCATION_CANCELLED');
    expect(s.capability).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.absent).not.toHaveBeenCalled();
  });

  it('checks the dispatch guard again after the capability and clock callbacks', async () => {
    const s = setup();
    let open = true;
    s.options.beforeDispatch = () => open;
    s.options.nowEpochSeconds = () => {
      open = false;
      return 1_800_000_000;
    };
    await expect(confirmRemoteRevocation(s.options)).rejects.toThrow('REMOTE_REVOCATION_CANCELLED');
    expect(s.remove).not.toHaveBeenCalled();
    expect(s.absent).not.toHaveBeenCalled();
  });

  it('does not dispatch the absence lookup if closed while removal was pending', async () => {
    const s = setup();
    const acknowledgment = deferred<void>();
    let open = true;
    s.options.beforeDispatch = () => open;
    s.remove.mockImplementation(() => acknowledgment.promise);
    const pending = confirmRemoteRevocation(s.options);
    open = false;
    acknowledgment.resolve();
    await expect(pending).rejects.toThrow('REMOTE_REVOCATION_CANCELLED');
    expect(s.absent).not.toHaveBeenCalled();
  });

  it('cannot confirm a late absence result after close', async () => {
    const s = setup();
    const lookup = deferred<boolean>();
    const dispatched = deferred<void>();
    let open = true;
    s.options.beforeDispatch = () => open;
    s.absent.mockImplementation(() => {
      dispatched.resolve();
      return lookup.promise;
    });
    const pending = confirmRemoteRevocation(s.options);
    await dispatched.promise;
    open = false;
    lookup.resolve(true);
    await expect(pending).rejects.toThrow('REMOTE_REVOCATION_CANCELLED');
    expect(s.remove).toHaveBeenCalledOnce();
    expect(s.absent).toHaveBeenCalledOnce();
  });
});
