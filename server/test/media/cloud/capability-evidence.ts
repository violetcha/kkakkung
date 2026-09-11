import type { CloudPreflight } from '../../../../tests/cloud/CloudPreflight.js';
import {
  parseCapabilityReport,
  type CapabilityReport,
} from '../../../src/media/CloudCapabilityProbe.js';
import { LIVEKIT_SDK_VERSION } from '../../../src/media/LiveKitGateway.js';

export const CREDENTIALS = [
  'LIVEKIT_HTTP_URL',
  'LIVEKIT_WS_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_PROJECT_ALIAS',
  'SERVICE_NAMESPACE',
] as const;
export const CUTOFF_BUFFER_SECONDS = 5;
export type CapabilityEvidence = {
  allowReceived: boolean;
  forbiddenRejected: boolean;
  deniedClientPositiveControl: boolean;
  revokedSubscriptionBlocked: boolean;
  neverJoinedTokenRejected: boolean;
  departedTokenRejected: boolean;
  refreshedTokenRejected: boolean;
  sameSecondRevocation: boolean;
  freshConnectionControl: boolean;
  cleanupConfirmed: boolean;
  clockOffsetUpperBoundMs: number | null;
};

export function emptyEvidence(): CapabilityEvidence {
  return {
    allowReceived: false,
    forbiddenRejected: false,
    deniedClientPositiveControl: false,
    revokedSubscriptionBlocked: false,
    neverJoinedTokenRejected: false,
    departedTokenRejected: false,
    refreshedTokenRejected: false,
    sameSecondRevocation: false,
    freshConnectionControl: false,
    cleanupConfirmed: false,
    clockOffsetUpperBoundMs: null,
  };
}

/** One failed identity must not suppress cleanup attempts for the remaining scoped identities. */
export async function confirmIdentityCleanup(
  identities: Iterable<string>,
  revokeAndCheck: (identity: string) => Promise<void>,
): Promise<boolean> {
  let confirmed = true;
  for (const identity of identities) {
    try {
      await revokeAndCheck(identity);
    } catch {
      confirmed = false;
    }
  }
  return confirmed;
}

/** Case-specific constraints supplement F's shared parser; called before any network operation. */
export function validateCapabilityPlan(p: CloudPreflight, env: Record<string, string | undefined>) {
  for (const name of CREDENTIALS)
    if (!p.credentialEnvNames.includes(name) || !env[name]?.trim())
      throw new Error(`MC01_REQUIRED_ENV:${name}`);
  if (env.LIVEKIT_PROJECT_ALIAS !== p.projectAlias || env.SERVICE_NAMESPACE !== p.namespace)
    throw new Error('MC01_PROJECT_OR_NAMESPACE_MISMATCH');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(p.namespace) || p.namespace.includes('--'))
    throw new Error('MC01_INVALID_NAMESPACE');
  for (const [name, protocol] of [
    ['LIVEKIT_HTTP_URL', 'https:'],
    ['LIVEKIT_WS_URL', 'wss:'],
  ] as const) {
    let url: URL;
    try {
      url = new URL(env[name]!);
    } catch {
      throw new Error(`MC01_INVALID_URL:${name}`);
    }
    if (
      url.protocol !== protocol ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error(`MC01_INVALID_URL:${name}`);
  }
  if (new URL(env.LIVEKIT_HTTP_URL!).host !== new URL(env.LIVEKIT_WS_URL!).host)
    throw new Error('MC01_ENDPOINT_MISMATCH');
  if (
    p.deviceManifest.mode !== 'synthetic' ||
    p.maxRooms < 1 ||
    p.maxParticipants < 5 ||
    p.maxDurationSeconds < 60 ||
    p.maxDurationSeconds > 300 ||
    p.cleanupAllowanceSeconds < 30 ||
    p.cleanupAllowanceSeconds > 120
  )
    throw new Error(
      'MC01_EXPECTS_SYNTHETIC_FIVE_IDENTITIES_60_TO_300_SECONDS_AND_30_TO_120_CLEANUP',
    );
  // Five identities conservatively reserved for the whole bounded run, including cleanup.
  // 1 MB/s exceeds synthetic 150 kbps video + 32 kbps audio and all receiver copies.
  const seconds = p.maxDurationSeconds + p.cleanupAllowanceSeconds;
  if (
    p.budgetReservation.participantMinutes < (5 * seconds) / 60 ||
    p.budgetReservation.bytes < seconds * 1_000_000
  )
    throw new Error('MC01_RESERVATION_TOO_SMALL');
  return {
    httpUrl: env.LIVEKIT_HTTP_URL!,
    wsUrl: env.LIVEKIT_WS_URL!,
    apiKey: env.LIVEKIT_API_KEY!,
    apiSecret: env.LIVEKIT_API_SECRET!,
  };
}

/** Network errors, missing measurements, and cleanup failures can never become SUPPORTED. */
export function capabilityReport(
  p: CloudPreflight,
  room: string,
  evidence: CapabilityEvidence,
  testedAtEpochMs: number,
  publisherMode = false,
): CapabilityReport {
  const { clockOffsetUpperBoundMs: offset, ...checks } = evidence;
  const supported =
    Object.values(checks).every((value) => value === true) &&
    offset !== null &&
    Number.isFinite(offset) &&
    offset >= 0 &&
    offset + CUTOFF_BUFFER_SECONDS * 1000 < 60_000;
  return parseCapabilityReport({
    status: supported ? 'SUPPORTED' : 'BLOCKED',
    ...(publisherMode ? { subscriptionMode: 'publisher-permissions' } : {}),
    sdkVersion: LIVEKIT_SDK_VERSION,
    cloudProjectAlias: p.projectAlias,
    namespace: p.namespace,
    testedAtEpochMs,
    grantProfile: supported
      ? {
          roomJoin: true,
          room,
          canPublishData: false,
          canSubscribe: publisherMode,
          canPublishSources: ['camera', 'microphone'],
          roomAdmin: false,
          roomRecord: false,
          roomCreate: false,
          roomList: false,
        }
      : null,
    revocationProfile: supported
      ? {
          mode: 'explicit-cutoff',
          bufferSeconds: CUTOFF_BUFFER_SECONDS,
          maxObservedClockOffsetMs: offset,
        }
      : null,
    allowReceived: evidence.allowReceived,
    forbiddenRejected: evidence.forbiddenRejected,
    revocationVerified:
      evidence.neverJoinedTokenRejected &&
      evidence.departedTokenRejected &&
      evidence.refreshedTokenRejected &&
      evidence.sameSecondRevocation &&
      evidence.freshConnectionControl,
    evidenceRefs: [`${p.evidenceDir}/capability-evidence.json`],
  });
}
