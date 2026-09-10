// F-02 / QA-01. The one place Cloud evidence is written. Every record carries the common header
// (sourceCommit, lockfileHash, protocolVersion, tuningVersion, SDK/browser versions, account
// alias, time, environment, stage, result, cleanup state) and the writer refuses anything that
// looks like a secret or raw media: tokens, JWTs, SDPs, cookies, API keys, faces or audio buffers.
// Rejected writes throw with the offending key path only, never the value. A minimum sample
// count is enforced so an empty run cannot be stored as a result.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type EvidenceHeader = Readonly<{
  sourceCommit: string;
  lockfileHash: string;
  protocolVersion: string;
  tuningVersion: string;
  sdkVersion: string;
  browserVersion: string | null;
  accountAlias: string;
  environment: 'local-fixture' | 'cloud-poc' | 'ec2';
  recordedAt: string;
  stage: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN' | 'INCOMPLETE';
  cleanupState: 'confirmed' | 'unresolved' | 'not-applicable';
}>;

export type EvidenceDocument = EvidenceHeader &
  Readonly<{ samples: readonly Record<string, unknown>[]; notes?: readonly string[] }>;

export const HEADER_KEYS = Object.freeze([
  'sourceCommit',
  'lockfileHash',
  'protocolVersion',
  'tuningVersion',
  'sdkVersion',
  'browserVersion',
  'accountAlias',
  'environment',
  'recordedAt',
  'stage',
  'result',
  'cleanupState',
] as const);

/** Key names that never belong in shared evidence, matched case-insensitively on every level. */
export const FORBIDDEN_KEYS =
  /^(token|jwt|accessToken|refreshToken|apiKey|apiSecret|secret|password|cookie|authorization|sdp|rawSdp|offer|answer|faceImage|audioBuffer|videoFrame|pixels|samplesPcm)$/i;
/** Value shapes that look like a JWT, a bearer header, an SDP blob or a data URL. */
const FORBIDDEN_VALUE =
  /^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+\S+|v=0\r?\n|data:(image|audio|video)\/)/;

export class EvidenceRejected extends Error {
  constructor(
    readonly code: 'FORBIDDEN_KEY' | 'FORBIDDEN_VALUE' | 'HEADER_MISSING' | 'TOO_FEW_SAMPLES',
    readonly path: string,
  ) {
    super(`${code}:${path}`);
  }
}

function scan(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'string') {
    if (FORBIDDEN_VALUE.test(value) || value.length > 4096)
      throw new EvidenceRejected('FORBIDDEN_VALUE', path);
    return;
  }
  if (value && typeof value === 'object') {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
      throw new EvidenceRejected('FORBIDDEN_VALUE', path);
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(key)) throw new EvidenceRejected('FORBIDDEN_KEY', `${path}.${key}`);
      scan(v, `${path}.${key}`);
    }
  }
}

/** Validates a document; returns it frozen or throws EvidenceRejected. */
export function validateEvidence(doc: EvidenceDocument, minimumSamples = 1): EvidenceDocument {
  for (const key of HEADER_KEYS) {
    const v = (doc as Record<string, unknown>)[key];
    if (v === undefined || v === '' || (key !== 'browserVersion' && v === null))
      throw new EvidenceRejected('HEADER_MISSING', key);
  }
  if (!/^[0-9a-f]{40}$/.test(doc.sourceCommit))
    throw new EvidenceRejected('HEADER_MISSING', 'sourceCommit');
  if (!/^[0-9a-f]{64}$/.test(doc.lockfileHash))
    throw new EvidenceRejected('HEADER_MISSING', 'lockfileHash');
  if (doc.result !== 'BLOCKED' && doc.result !== 'NOT_RUN' && doc.samples.length < minimumSamples)
    throw new EvidenceRejected(
      'TOO_FEW_SAMPLES',
      `samples(${doc.samples.length}<${minimumSamples})`,
    );
  scan(doc, '$');
  return Object.freeze(structuredClone(doc));
}

/** Writes `<dir>/<name>.json` after validation. Never logs the document. */
export function writeEvidence(
  dir: string,
  name: string,
  doc: EvidenceDocument,
  minimumSamples = 1,
): string {
  const valid = validateEvidence(doc, minimumSamples);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(valid, null, 2) + '\n');
  return file;
}

/** Estimates the offset of a remote clock from round-trip pings; never subtracts raw deltas. */
export function estimateClockOffset(
  pings: readonly Readonly<{ sentAtMs: number; remoteAtMs: number; receivedAtMs: number }>[],
): Readonly<{ offsetMs: number; uncertaintyMs: number; samples: number }> | null {
  if (pings.length === 0) return null;
  // NTP-style: offset = remote - midpoint(local send, local receive); uncertainty = half RTT (min).
  let best: { offset: number; halfRtt: number } | null = null;
  for (const p of pings) {
    const halfRtt = (p.receivedAtMs - p.sentAtMs) / 2;
    if (halfRtt < 0) continue;
    const offset = p.remoteAtMs - (p.sentAtMs + halfRtt);
    if (!best || halfRtt < best.halfRtt) best = { offset, halfRtt };
  }
  if (!best) return null;
  return { offsetMs: best.offset, uncertaintyMs: best.halfRtt, samples: pings.length };
}

/**
 * Effective latency of one policy decision: server `policyAt` (server clock) → browser
 * `effectAt` (browser clock), corrected by the estimated offset. Returns null ("unconfirmed")
 * when the uncertainty makes the threshold judgement impossible.
 */
export function effectiveLatencyMs(
  policyAtServerMs: number,
  effectAtBrowserMs: number,
  offset: Readonly<{ offsetMs: number; uncertaintyMs: number }>,
  thresholdMs: number,
): Readonly<{ latencyMs: number; confirmed: boolean }> {
  const latency = effectAtBrowserMs - offset.offsetMs - policyAtServerMs;
  const confirmed = Math.abs(latency - thresholdMs) > offset.uncertaintyMs;
  return { latencyMs: latency, confirmed };
}
