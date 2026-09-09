import type { CapabilityReport } from './CloudCapabilityProbe.js';

export type RemoteRevocationOptions = {
  capability: () => CapabilityReport | null;
  nowEpochSeconds: () => number;
  remove: (cutoff?: bigint) => Promise<void>;
  absent: () => Promise<boolean>;
  beforeDispatch?: () => boolean;
};

/** Requires a successful revocation call before participant absence can confirm removal. */
export async function confirmRemoteRevocation(options: RemoteRevocationOptions): Promise<void> {
  const guard = () => {
    if (options.beforeDispatch && !options.beforeDispatch()) {
      throw new Error('REMOTE_REVOCATION_CANCELLED');
    }
  };
  guard();
  const profile = options.capability();
  if (
    profile?.status !== 'SUPPORTED' ||
    !profile.revocationProfile ||
    !profile.revocationVerified
  ) {
    throw new Error('CAPABILITY_UNVERIFIED');
  }
  const now = options.nowEpochSeconds();
  const revoke = profile.revocationProfile;
  if (
    !Number.isFinite(now) ||
    now <= 0 ||
    !Number.isSafeInteger(Math.floor(now)) ||
    !Number.isSafeInteger(revoke.bufferSeconds) ||
    revoke.bufferSeconds < 0 ||
    !Number.isFinite(revoke.maxObservedClockOffsetMs) ||
    revoke.maxObservedClockOffsetMs < 0 ||
    revoke.bufferSeconds * 1000 + revoke.maxObservedClockOffsetMs >= 60_000
  ) {
    throw new Error('INVALID_CLOCK');
  }
  const cutoff =
    revoke.mode === 'explicit-cutoff' ? BigInt(Math.floor(now) + revoke.bufferSeconds) : undefined;
  guard();
  await options.remove(cutoff);
  guard();
  // A 404, room absence or expiration cannot replace the acknowledged revocation call.
  const absent = await options.absent();
  guard();
  if (!absent) throw new Error('PARTICIPANT_REMAINS');
}
