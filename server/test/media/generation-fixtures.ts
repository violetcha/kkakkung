import type { CapabilityReport } from '../../src/media/CloudCapabilityProbe.js';
import type {
  MediaConfiguration,
  PrepareGenerationRequest,
  TrustedMediaFrame,
} from '../../src/media/types.js';

export const localCapability: CapabilityReport = {
  status: 'SUPPORTED',
  sdkVersion: '2.18.0',
  cloudProjectAlias: 'local-fixture',
  namespace: 'e-fixture',
  testedAtEpochMs: 1_800_000_000_000,
  grantProfile: {
    roomJoin: true,
    room: 'probe-room',
    canPublishData: false,
    canSubscribe: false,
    canPublishSources: ['camera', 'microphone'],
    roomAdmin: false,
    roomRecord: false,
    roomCreate: false,
    roomList: false,
  },
  revocationProfile: { mode: 'explicit-cutoff', bufferSeconds: 2, maxObservedClockOffsetMs: 100 },
  allowReceived: true,
  forbiddenRejected: true,
  revocationVerified: true,
  evidenceRefs: ['synthetic-local-only-not-cloud-evidence'],
};
export function localConfiguration(now = Date.now()): MediaConfiguration {
  return {
    httpUrl: 'https://fixture.invalid',
    wsUrl: 'wss://fixture.invalid',
    apiKey: 'local-test-key',
    apiSecret: 'local-test-signing-secret-no-cloud-access',
    namespace: 'e-fixture',
    opsDataDir: '.local/unused-unit-path',
    projectAlias: 'local-fixture',
    publicWindow: { opensAtEpochMs: now - 1000, closesAtEpochMs: now + 600_000 },
    officialBudgetMaxAgeMs: 3_600_000,
    operationTimeoutMs: 1000,
    productSecurityReady: true,
    initialBudget: null,
    maxConcurrentParticipants: 6,
    maxNormalApiCallsPer60s: 600,
    maxTotalApiCallsPer60s: 900,
  };
}
export const prepareRequest: PrepareGenerationRequest = {
  requestId: 'prepare-1',
  matchId: 'm',
  playerId: 'p',
  mediaInstanceId: 'practice',
  purpose: 'practice',
  expectedPreviousGeneration: null,
};
export const practiceFrame: TrustedMediaFrame = {
  matchId: 'm',
  mediaInstanceId: 'practice',
  instancePurpose: 'practice',
  frameRevision: 1,
  tick: 1,
  phase: 'TEAM_PRACTICE',
  topology: { topologyVersion: 'tiny', width: 1, height: 1, walkable: [true] },
  participants: [
    { playerId: 'p', role: 'runner', status: 'ACTIVE', cell: { x: 0, y: 0 }, dir: 0, action: null },
  ],
  events: [],
};
export function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
