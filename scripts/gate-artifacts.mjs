import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { PRODUCT_PROTOCOL_VERSION } from '../packages/protocol/src/version.ts';
import { evaluateIntegrated } from '../tests/load/TenRoomSchedule.ts';
import { validateSixDeviceRecords } from './collect-six-device-results.mjs';
import { evidenceTime, isCommit, isCount, isObject } from './evidence-values.mjs';

export const GATE_TEST_FILES = Object.freeze({
  'G1-A': ['tests/cloud/g1-a.cloud.test.ts'],
  'G1-B': ['tests/cloud/g1-b.cloud.test.ts'],
  'G1-C': ['tests/cloud/g1-c.cloud.test.ts'],
  'G1-D': ['tests/cloud/g1-d.cloud.test.ts'],
  'G3-A': ['tests/contracts/g3-room.test.ts'],
  'G3-B': ['tests/contracts/g3-room.test.ts'],
  'G3-D': ['tests/contracts/g3-overload.test.ts'],
  G4: [
    'tests/contracts/g4-packets.test.ts',
    'tests/contracts/g4-bundle.test.ts',
    'tests/cloud/g4-metadata.cloud.test.ts',
  ],
});
const hashPattern = /^[0-9a-f]{64}$/;
const within = (base, target) => {
  const rel = relative(base, target);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
};

/** Read bytes once, hash those same bytes, then parse. Directories and symlink escapes fail. */
export function createEvidenceReader(root, input) {
  const bases = [root, input].map((base) => resolve(base));
  return (ref) => {
    if (typeof ref !== 'string' || !ref || isAbsolute(ref) || ref.includes('\0')) return null;
    for (const base of bases) {
      const path = resolve(base, ref);
      if (!within(base, path)) continue;
      try {
        const actual = realpathSync(path);
        if (!within(realpathSync(base), actual)) continue;
        const stat = statSync(actual);
        if (!stat.isFile() || stat.size < 2 || stat.size > 32 * 1024 * 1024) continue;
        const bytes = readFileSync(actual);
        return {
          document: JSON.parse(bytes.toString('utf8')),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      } catch {
        /* Missing, unreadable and malformed artifacts are unverified. */
      }
    }
    return null;
  };
}

export function readBoundArtifact(ref, hashes, read) {
  const expected = hashes?.[ref];
  if (typeof expected !== 'string' || !hashPattern.test(expected))
    throw new Error('evidence SHA-256 missing');
  const loaded = read(ref);
  if (!isObject(loaded) || !isObject(loaded.document))
    throw new Error('evidence missing or not a JSON object');
  if (loaded.sha256 !== expected) throw new Error('evidence SHA-256 mismatch');
  return loaded.document;
}

export function validateArtifactHeader(doc, build, scope, now) {
  if (doc.evidenceVersion !== 1 || doc.scope !== scope)
    throw new Error('evidence version/scope mismatch');
  if (!isCommit(build.sourceCommit) || doc.sourceCommit !== build.sourceCommit)
    throw new Error('evidence sourceCommit mismatch');
  if (!hashPattern.test(build.lockfileHash ?? '') || doc.lockfileHash !== build.lockfileHash)
    throw new Error('evidence lockfileHash mismatch');
  if (doc.protocolVersion !== PRODUCT_PROTOCOL_VERSION)
    throw new Error('evidence protocolVersion mismatch');
  if (!['local-fixture', 'cloud-poc', 'ec2'].includes(doc.environment))
    throw new Error('evidence environment invalid');
  const recorded = evidenceTime(doc.recordedAt);
  if (recorded === null || recorded > now) throw new Error('evidence recordedAt invalid or future');
  if (!['PASS', 'FAIL'].includes(doc.result)) throw new Error('evidence has no terminal result');
}

function validateTestReports(reports, expectedFiles, expectedResult) {
  if (!Array.isArray(reports) || !reports.length) throw new Error('native test reports missing');
  const seen = new Set();
  let failed = false;
  let assertions = 0;
  for (const report of reports) {
    if (!isObject(report) || !Array.isArray(report.testResults) || !report.testResults.length)
      throw new Error('native test report invalid');
    let total = 0,
      passed = 0,
      failures = 0;
    for (const suite of report.testResults) {
      if (
        !isObject(suite) ||
        typeof suite.name !== 'string' ||
        !Array.isArray(suite.assertionResults) ||
        !suite.assertionResults.length
      )
        throw new Error('test suite missing assertions');
      const file = expectedFiles.find(
        (path) => suite.name.replaceAll('\\', '/').endsWith('/' + path) || suite.name === path,
      );
      if (!file) continue;
      if (seen.has(file)) throw new Error('duplicate required test suite');
      seen.add(file);
      for (const test of suite.assertionResults) {
        if (!isObject(test) || !test.fullName || !['passed', 'failed'].includes(test.status))
          throw new Error('test skipped, pending or malformed');
        total++;
        if (test.status === 'passed') passed++;
        else failures++;
      }
    }
    // The artifact must contain the required suites, not an unrelated complete repository report.
    if (
      total === 0 ||
      report.numTotalTests !== total ||
      report.numPassedTests !== passed ||
      report.numFailedTests !== failures ||
      report.numPendingTests !== 0 ||
      report.success !== (failures === 0)
    )
      throw new Error('test counts/result contradict assertions');
    failed ||= failures > 0;
    assertions += total;
  }
  if (expectedFiles.some((file) => !seen.has(file))) throw new Error('required test suite missing');
  if ((failed ? 'FAIL' : 'PASS') !== expectedResult)
    throw new Error('test report contradicts declared result');
  return { assertions };
}

/** Recompute supported measured results; a manifest PASS never creates a measured PASS. */
export function validateGateArtifact(doc, gate, build, now) {
  validateArtifactHeader(doc, build, 'confirmed-mvp', now);
  if (
    doc.gate !== gate.gate ||
    doc.result !== gate.status ||
    doc.environment !== gate.environmentRef
  )
    throw new Error('evidence gate/result/environment mismatch');
  const cloud = gate.gate.startsWith('G1-') || ['G2', 'G4', 'G6'].includes(gate.gate);
  const requiredMode = cloud
    ? 'cloud'
    : gate.gate === 'G5'
      ? 'real-devices'
      : 'product-integration';
  if (
    doc.executionMode !== requiredMode ||
    ((cloud || gate.gate === 'G5') && doc.environment === 'local-fixture')
  )
    throw new Error('execution mode cannot certify this gate');
  if (gate.gate === 'G5') {
    const result = validateSixDeviceRecords(doc.records);
    if (result.status !== doc.result || result.summary.sourceCommit !== build.sourceCommit)
      throw new Error('six-device raw records contradict result/source');
    if (
      doc.records.matches.matches.some(
        (match) => evidenceTime(match.endedAt) > evidenceTime(doc.recordedAt),
      )
    )
      throw new Error('six-device report predates the recorded matches');
    return { devices: result.summary.realDevices, matches: result.summary.matches };
  } else if (gate.gate === 'G2' || gate.gate === 'G6') {
    const result = evaluateIntegrated(doc.integratedEvidence);
    if (
      result.gates.find((entry) => entry.gate === gate.gate)?.status !== doc.result ||
      doc.integratedEvidence?.run?.sourceCommit !== build.sourceCommit
    )
      throw new Error('integrated raw measurements contradict result/source');
    if (doc.integratedEvidence.run.endedAtEpochMs > evidenceTime(doc.recordedAt))
      throw new Error('integrated report predates the run');
    if (doc.result === 'PASS' && result.publishHold)
      throw new Error('integrated cleanup remains unconfirmed');
    return {
      measuredSixtySeconds: result.measuredSixtySeconds,
      normalWindows: result.normalWindows,
    };
  } else {
    const files = GATE_TEST_FILES[gate.gate];
    if (!files) throw new Error('unsupported gate evidence');
    return validateTestReports(doc.testReports, files, doc.result);
  }
}

/** Continuous release readiness is separate from actual public acceptance. */
export function evaluateRelease(pub, read, build, now) {
  const problems = [];
  let audience = 'unknown';
  let operatingMode = 'unknown';
  try {
    const doc = readBoundArtifact(pub?.evidenceRef, pub?.evidenceSha256, read);
    validateArtifactHeader(doc, build, 'operations-release', now);
    if (doc.result !== 'PASS' || doc.environment !== 'ec2')
      throw new Error('operations evidence is not a successful deployed check');
    audience = doc.audience;
    operatingMode = doc.operatingMode;
    if (!['team-only', 'public'].includes(audience)) problems.push('audience unknown');
    if (!['continuous', 'attested'].includes(operatingMode))
      problems.push('operating mode unknown');
    if (doc.isolationVerified !== true) problems.push('external isolation not verified');
    if (!isCount(doc.unresolvedRetirements) || doc.unresolvedRetirements !== 0)
      problems.push('retirements not confirmed');
    if (doc.smokeCleanupConfirmed !== true) problems.push('smoke cleanup not confirmed');
    if (doc.readiness !== 'READY' || doc.admission !== 'OPEN')
      problems.push('READY/OPEN not confirmed');
    if (operatingMode === 'continuous') {
      if (doc.serviceBudgetStatus !== 'within-limit')
        problems.push('continuous service budget not confirmed');
    } else if (operatingMode === 'attested') {
      const checked = evidenceTime(doc.officialBudgetCheckedAt);
      const expires = evidenceTime(doc.officialBudgetExpiresAt);
      if (
        checked === null ||
        expires === null ||
        checked > now ||
        expires <= now ||
        checked >= expires
      )
        problems.push('attested official budget invalid or expired');
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'operations evidence invalid');
  }
  return { ready: problems.length === 0, audience, operatingMode, problems };
}
