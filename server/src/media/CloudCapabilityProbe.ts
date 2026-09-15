import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LIVEKIT_SDK_VERSION } from './LiveKitGateway.js';
import {
  parseSplitAuthorityProof,
  parseSplitGrantProfile,
  SPLIT_AUTHORITY_CHECKS,
  type SplitAuthorityProof,
  type SplitGrantProfile,
} from './SplitCapability.js';

export type MinimumGrantProfile = Readonly<{
  roomJoin: true;
  room: string;
  canPublishData: false;
  canSubscribe: boolean;
  canPublishSources: readonly ['camera', 'microphone'] | readonly ['microphone', 'camera'];
  roomAdmin: false;
  roomRecord: false;
  roomCreate: false;
  roomList: false;
}>;

export type RevocationProfile = Readonly<{
  mode: 'sdk-default' | 'explicit-cutoff';
  bufferSeconds: number;
  maxObservedClockOffsetMs: number;
}>;

export type CapabilityReport = Readonly<{
  subscriptionMode?: 'publisher-permissions' | 'server-forwarding';
  splitGrantProfile?: SplitGrantProfile | null;
  splitAuthorityProof?: SplitAuthorityProof | null;
  status: 'SUPPORTED' | 'BLOCKED';
  sdkVersion: string;
  cloudProjectAlias: string;
  namespace: string;
  testedAtEpochMs: number;
  grantProfile: MinimumGrantProfile | null;
  revocationProfile: RevocationProfile | null;
  allowReceived: boolean;
  forbiddenRejected: boolean;
  revocationVerified: boolean;
  evidenceRefs: readonly string[];
}>;

export class InvalidCapabilityReport extends Error {
  constructor(readonly field: string) {
    super(`INVALID_CAPABILITY_REPORT:${field}`);
    this.name = 'InvalidCapabilityReport';
  }
}

function record(input: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    !Object.keys(input).every((key) => keys.includes(key))
  ) {
    throw new InvalidCapabilityReport(field);
  }
  return input as Record<string, unknown>;
}

function identifier(input: unknown, field: string): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(input)) {
    throw new InvalidCapabilityReport(field);
  }
  return input;
}

function number(input: unknown, field: string, integer: boolean, minimum = 0): number {
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    (integer && !Number.isSafeInteger(input)) ||
    input < minimum
  ) {
    throw new InvalidCapabilityReport(field);
  }
  return input;
}

function grant(input: unknown, publisherMode: boolean): MinimumGrantProfile {
  const data = record(
    input,
    [
      'roomJoin',
      'room',
      'canPublishData',
      'canSubscribe',
      'canPublishSources',
      'roomAdmin',
      'roomRecord',
      'roomCreate',
      'roomList',
    ],
    'grantProfile',
  );
  if (
    data.roomJoin !== true ||
    data.canSubscribe !== publisherMode ||
    ['canPublishData', 'roomAdmin', 'roomRecord', 'roomCreate', 'roomList'].some(
      (key) => data[key] !== false,
    ) ||
    !Array.isArray(data.canPublishSources) ||
    data.canPublishSources.length !== 2 ||
    !data.canPublishSources.includes('camera') ||
    !data.canPublishSources.includes('microphone')
  ) {
    throw new InvalidCapabilityReport('grantProfile');
  }
  return Object.freeze({
    roomJoin: true,
    room: identifier(data.room, 'grantProfile.room'),
    canPublishData: false,
    canSubscribe: publisherMode,
    canPublishSources: Object.freeze(['camera', 'microphone'] as const),
    roomAdmin: false,
    roomRecord: false,
    roomCreate: false,
    roomList: false,
  });
}

function revocation(input: unknown): RevocationProfile {
  const data = record(
    input,
    ['mode', 'bufferSeconds', 'maxObservedClockOffsetMs'],
    'revocationProfile',
  );
  if (!['sdk-default', 'explicit-cutoff'].includes(String(data.mode))) {
    throw new InvalidCapabilityReport('revocationProfile.mode');
  }
  const bufferSeconds = number(data.bufferSeconds, 'revocationProfile.bufferSeconds', true);
  const maxObservedClockOffsetMs = number(
    data.maxObservedClockOffsetMs,
    'revocationProfile.maxObservedClockOffsetMs',
    false,
  );
  // Cloud only permits a cutoff within 60 seconds of its clock.
  if (bufferSeconds * 1_000 + maxObservedClockOffsetMs >= 60_000) {
    throw new InvalidCapabilityReport('revocationProfile.clockWindow');
  }
  return Object.freeze({
    mode: data.mode as RevocationProfile['mode'],
    bufferSeconds,
    maxObservedClockOffsetMs,
  });
}

/** Validates structure only. E's MC-01 harness measures Cloud behavior; F approves the evidence. */
export function parseCapabilityReport(input: unknown): CapabilityReport {
  const hasMode = !!input && typeof input === 'object' && 'subscriptionMode' in input;
  const forwardingMode = hasMode && input.subscriptionMode === 'server-forwarding';
  const publisherMode = hasMode && !forwardingMode;
  const data = record(
    input,
    [
      'status',
      'sdkVersion',
      'cloudProjectAlias',
      'namespace',
      'testedAtEpochMs',
      'grantProfile',
      'revocationProfile',
      'allowReceived',
      'forbiddenRejected',
      'revocationVerified',
      'evidenceRefs',
      ...(hasMode ? ['subscriptionMode'] : []),
      ...(forwardingMode ? ['splitGrantProfile', 'splitAuthorityProof'] : []),
    ],
    'report',
  );
  if (publisherMode && data.subscriptionMode !== 'publisher-permissions')
    throw new InvalidCapabilityReport('subscriptionMode');
  if (forwardingMode && data.grantProfile !== null)
    throw new InvalidCapabilityReport('splitGrantProfile');
  if (data.status !== 'SUPPORTED' && data.status !== 'BLOCKED') {
    throw new InvalidCapabilityReport('status');
  }
  for (const field of ['allowReceived', 'forbiddenRejected', 'revocationVerified']) {
    if (typeof data[field] !== 'boolean') throw new InvalidCapabilityReport(field);
  }
  if (!Array.isArray(data.evidenceRefs) || data.evidenceRefs.length > 100) {
    throw new InvalidCapabilityReport('evidenceRefs');
  }
  const evidenceRefs = data.evidenceRefs.map((value: unknown) => {
    // Relative, portable evidence references only: no credentials, URLs, query strings, or JWTs.
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 256 ||
      !/^[A-Za-z0-9_.\-/]+$/.test(value) ||
      value.startsWith('/') ||
      value.split('/').some((part) => part === '..' || part === '') ||
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
    ) {
      throw new InvalidCapabilityReport('evidenceRefs');
    }
    return value;
  });
  if (new Set(evidenceRefs).size !== evidenceRefs.length) {
    throw new InvalidCapabilityReport('evidenceRefs');
  }
  const grantProfile = data.grantProfile === null ? null : grant(data.grantProfile, publisherMode);
  const revocationProfile =
    data.revocationProfile === null ? null : revocation(data.revocationProfile);
  const splitGrantProfile =
    forwardingMode && data.splitGrantProfile !== null
      ? parseSplitGrantProfile(data.splitGrantProfile)
      : null;
  const splitAuthorityProof =
    forwardingMode && data.splitAuthorityProof !== null
      ? parseSplitAuthorityProof(data.splitAuthorityProof)
      : null;
  if (
    data.status === 'SUPPORTED' &&
    ((forwardingMode
      ? !splitGrantProfile ||
        !splitAuthorityProof ||
        SPLIT_AUTHORITY_CHECKS.some((key) => splitAuthorityProof[key] !== true)
      : !grantProfile) ||
      !revocationProfile ||
      !data.allowReceived ||
      !data.forbiddenRejected ||
      !data.revocationVerified ||
      evidenceRefs.length === 0)
  ) {
    throw new InvalidCapabilityReport('supportedEvidence');
  }
  const report: CapabilityReport = Object.freeze({
    status: data.status,
    ...(publisherMode ? { subscriptionMode: 'publisher-permissions' as const } : {}),
    ...(forwardingMode
      ? { subscriptionMode: 'server-forwarding' as const, splitGrantProfile, splitAuthorityProof }
      : {}),
    sdkVersion: identifier(data.sdkVersion, 'sdkVersion'),
    cloudProjectAlias: identifier(data.cloudProjectAlias, 'cloudProjectAlias'),
    namespace: identifier(data.namespace, 'namespace'),
    testedAtEpochMs: number(data.testedAtEpochMs, 'testedAtEpochMs', true, 1),
    grantProfile,
    revocationProfile,
    allowReceived: data.allowReceived as boolean,
    forbiddenRejected: data.forbiddenRejected as boolean,
    revocationVerified: data.revocationVerified as boolean,
    evidenceRefs: Object.freeze(evidenceRefs),
  });
  parsedReports.add(report);
  return report;
}

/** Every nested value of a parse result is frozen, so it needs no second structural check. */
const parsedReports = new WeakSet<object>();
export function isParsedCapabilityReport(value: unknown): value is CapabilityReport {
  return typeof value === 'object' && value !== null && parsedReports.has(value);
}

export type CapabilityLoadResult =
  | Readonly<{ status: 'supported'; report: CapabilityReport }>
  | Readonly<{ status: 'blocked'; report: null; reasons: readonly string[] }>;

/** No environment access, network calls, or permissive fallback is performed by this loader. */
export async function loadCapabilityReport(options: {
  subscriptionMode?: 'server-controlled' | 'publisher-permissions' | 'server-forwarding';
  opsDataDir: string;
  projectAlias: string;
  namespace: string;
  sdkVersion?: string;
  nowEpochMs?: number;
  expectedRevocationProfile?: RevocationProfile;
}): Promise<CapabilityLoadResult> {
  let input: unknown;
  try {
    const text = await readFile(join(options.opsDataDir, 'capability-report.json'), 'utf8');
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
      return { status: 'blocked', report: null, reasons: ['CAPABILITY_REPORT_TOO_LARGE'] };
    }
    input = JSON.parse(text);
  } catch (error) {
    const missing =
      error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
    return {
      status: 'blocked',
      report: null,
      reasons: [missing ? 'CAPABILITY_REPORT_MISSING' : 'CAPABILITY_REPORT_UNREADABLE'],
    };
  }
  let report: CapabilityReport;
  try {
    report = parseCapabilityReport(input);
  } catch {
    return { status: 'blocked', report: null, reasons: ['CAPABILITY_REPORT_INVALID'] };
  }
  const reasons: string[] = [];
  if (
    (report.subscriptionMode ?? 'server-controlled') !==
    (options.subscriptionMode ?? 'server-controlled')
  )
    reasons.push('CAPABILITY_SUBSCRIPTION_MODE_MISMATCH');
  if (report.status !== 'SUPPORTED') reasons.push('CLOUD_CAPABILITY_BLOCKED');
  if (report.cloudProjectAlias !== options.projectAlias)
    reasons.push('CAPABILITY_PROJECT_MISMATCH');
  if (report.namespace !== options.namespace) reasons.push('CAPABILITY_NAMESPACE_MISMATCH');
  if (report.sdkVersion !== (options.sdkVersion ?? LIVEKIT_SDK_VERSION)) {
    reasons.push('CAPABILITY_SDK_MISMATCH');
  }
  if (
    options.nowEpochMs !== undefined &&
    (!Number.isSafeInteger(options.nowEpochMs) || report.testedAtEpochMs > options.nowEpochMs)
  ) {
    reasons.push('CAPABILITY_REPORT_FUTURE');
  }
  const expected = options.expectedRevocationProfile;
  if (
    expected &&
    (expected.mode !== report.revocationProfile?.mode ||
      expected.bufferSeconds !== report.revocationProfile.bufferSeconds ||
      expected.maxObservedClockOffsetMs !== report.revocationProfile.maxObservedClockOffsetMs)
  ) {
    reasons.push('CAPABILITY_PROFILE_CHANGED');
  }
  return reasons.length === 0
    ? { status: 'supported', report }
    : { status: 'blocked', report: null, reasons };
}
