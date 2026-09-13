// Synthetic evaluator fixtures only; these do not attest to actual Cloud or physical device runs.
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvidenceReader, GATE_TEST_FILES } from '../../scripts/gate-artifacts.mjs';
import {
  evaluateGates,
  injectReport,
  renderReport,
  REQUIRED_GATES,
  type EvidenceReader,
  type GateManifest,
} from '../../scripts/verify-mvp-evidence.mjs';
import { devices, matches, SHA, perDevice } from '../fixtures/six-device-records.js';
import { input as integrated } from '../fixtures/integrated-evidence.js';

const LOCK = 'b'.repeat(64);
const NOW = 1_800_002_000_000;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture() {
  const documents = new Map<string, Record<string, unknown>>();
  const common = {
    evidenceVersion: 1,
    sourceCommit: SHA,
    lockfileHash: LOCK,
    protocolVersion: '0.2.0',
    environment: 'ec2',
    recordedAt: new Date(NOW - 1).toISOString(),
    result: 'PASS',
  };
  const gates = REQUIRED_GATES.map((gate) => {
    const files = GATE_TEST_FILES[gate];
    const doc = {
      ...common,
      gate,
      scope: 'confirmed-mvp',
      executionMode: gate.startsWith('G3')
        ? 'product-integration'
        : gate === 'G5'
          ? 'real-devices'
          : 'cloud',
      ...(files
        ? {
            testReports: [
              {
                success: true,
                numTotalTests: files.length,
                numPassedTests: files.length,
                numFailedTests: 0,
                numPendingTests: 0,
                testResults: files.map((name) => ({
                  name,
                  assertionResults: [{ fullName: `${gate} synthetic result`, status: 'passed' }],
                })),
              },
            ],
          }
        : {}),
      ...(gate === 'G5' ? { records: { devices: devices(), matches: matches() } } : {}),
      ...(['G2', 'G6'].includes(gate) ? { integratedEvidence: integrated() } : {}),
    };
    const ref = `${gate}.json`;
    documents.set(ref, doc);
    return {
      gate,
      status: 'PASS' as const,
      sourceCommit: SHA,
      environmentRef: 'ec2',
      evidenceRefs: [ref],
      evidenceSha256: { [ref]: hash(doc) },
    };
  });
  documents.set('release.json', {
    ...common,
    scope: 'operations-release',
    audience: 'public',
    operatingMode: 'continuous',
    isolationVerified: true,
    unresolvedRetirements: 0,
    smokeCleanupConfirmed: true,
    readiness: 'READY',
    admission: 'OPEN',
    serviceBudgetStatus: 'within-limit',
  });
  const manifest: GateManifest = {
    headCommit: SHA,
    featureState: 'synthetic validation fixture',
    capacity: { gameOnlyRooms: 99, withMediaRooms: 99 },
    gates: [...gates, { gate: 'G3-C', status: 'PRODUCT_DECISION_PENDING' }],
    publication: {
      evidenceRef: 'release.json',
      evidenceSha256: { 'release.json': hash(documents.get('release.json')) },
    },
  };
  const read: EvidenceReader = (ref) =>
    documents.has(ref) ? { document: documents.get(ref), sha256: hash(documents.get(ref)) } : null;
  const patch = (ref: string, change: Record<string, unknown>, updateHash = true) => {
    documents.set(ref, { ...documents.get(ref), ...change });
    if (updateHash) {
      const expected =
        ref === 'release.json'
          ? manifest.publication!.evidenceSha256!
          : gates.find((g) => g.evidenceRefs.includes(ref))!.evidenceSha256;
      expected[ref] = hash(documents.get(ref));
    }
  };
  const evaluate = (source = manifest) =>
    evaluateGates(source, read, SHA, { lockfileHash: LOCK, nowEpochMs: NOW });
  return { manifest, documents, read, patch, evaluate };
}

describe('MVP evidence content and build binding', () => {
  it('accepts complete matching raw reports and keeps the item gate pending', () => {
    const f = fixture();
    const r = f.evaluate();
    expect(r.summary).toMatchObject({
      pass: 11,
      mvpComplete: true,
      pending: ['G3-C'],
      unverified: 0,
    });
    expect(r.release.ready).toBe(true);
    expect(r.publication.allowed).toBe(true);
    expect(r.summary.capacity).toEqual({ gameOnlyRooms: 0, withMediaRooms: 10 });
    expect(r.summary.declaredCapacity).toEqual({ gameOnlyRooms: 99, withMediaRooms: 99 });
  });

  it.each([
    'sourceCommit',
    'lockfileHash',
    'gate',
    'environment',
    'executionMode',
    'scope',
    'protocolVersion',
    'recordedAt',
    'result',
  ])('rejects contradictory artifact %s despite a manifest PASS and a recomputed hash', (field) => {
    const f = fixture();
    f.patch('G1-A.json', { [field]: 'invalid' });
    expect(f.evaluate().gates.find((g) => g.gate === 'G1-A')?.status).toBe('UNVERIFIED');
    expect(f.evaluate().summary.mvpComplete).toBe(false);
  });

  it('requires the actual checkout/lock and never accepts the feature-branch escape flag', () => {
    const f = fixture();
    const other = {
      ...f.manifest,
      gates: f.manifest.gates.map((g) => ({
        ...g,
        sourceCommit: 'c'.repeat(40),
        sourceCommitIsFeatureBranch: true,
      })),
    };
    expect(f.evaluate(other).summary.pass).toBe(0);
    expect(f.evaluate({ ...f.manifest, headCommit: 'd'.repeat(40) }).summary.pass).toBe(0);
    expect(evaluateGates(f.manifest, f.read, null, { lockfileHash: LOCK }).summary.pass).toBe(0);
    expect(evaluateGates(f.manifest, f.read, SHA).summary.pass).toBe(0);
  });

  it('detects changed bytes, missing hashes, absent JSON and boolean existence-only readers', () => {
    const f = fixture();
    f.patch('G1-A.json', { scope: 'changed' }, false);
    expect(f.evaluate().gates[0]?.problems).toContain('evidence SHA-256 mismatch');
    f.documents.delete('G4.json');
    expect(f.evaluate().gates.find((g) => g.gate === 'G4')?.status).toBe('UNVERIFIED');
    const missingHash = {
      ...f.manifest,
      gates: f.manifest.gates.map((g) => ({ ...g, evidenceSha256: {} })),
    };
    expect(f.evaluate(missingHash).summary.pass).toBe(0);
    const existsOnly = (() => true) as unknown as EvidenceReader;
    expect(evaluateGates(f.manifest, existsOnly, SHA, { lockfileHash: LOCK }).summary.pass).toBe(0);
  });

  it('duplicate/unknown gates or duplicate references cannot inflate acceptance', () => {
    for (const gate of [
      fixture().manifest.gates[0]!,
      { gate: 'invented', status: 'PASS' as const },
    ]) {
      const f = fixture();
      const r = f.evaluate({ ...f.manifest, gates: [...f.manifest.gates, gate] });
      expect(r.summary.mvpComplete).toBe(false);
      expect(r.summary.pass).toBeLessThanOrEqual(11);
    }
    const f = fixture();
    expect(
      f.evaluate({
        ...f.manifest,
        gates: f.manifest.gates.map((g) => ({
          ...g,
          evidenceRefs: [...(g.evidenceRefs ?? []), ...(g.evidenceRefs ?? [])],
        })),
      }).summary.pass,
    ).toBe(0);
  });

  it.each([
    { testReports: [] },
    { testReports: [{ success: true, numTotalTests: 0, testResults: [] }] },
    {
      testReports: [
        {
          success: true,
          numTotalTests: 1,
          numPassedTests: 1,
          numFailedTests: 0,
          numPendingTests: 0,
          testResults: [
            {
              name: 'tests/cloud/g1-a.cloud.test.ts',
              assertionResults: [{ fullName: 'claimed', status: 'skipped' }],
            },
          ],
        },
      ],
    },
  ])('rejects empty or skipped native test results %j', (patch) => {
    const f = fixture();
    f.patch('G1-A.json', patch);
    expect(f.evaluate().summary.mvpComplete).toBe(false);
  });

  it('recomputes G5/G6 raw measurements instead of trusting PASS summaries', () => {
    const f = fixture();
    f.patch('G5.json', {
      records: {
        devices: devices(),
        matches: matches((m) => ({
          ...m,
          devices: perDevice({ remoteFaces: 0, nearVoice: false }),
        })),
      },
    });
    f.patch('G6.json', {
      integratedEvidence: integrated({ windows: integrated().windows.slice(0, 1) }),
    });
    const r = f.evaluate();
    expect(r.gates.find((g) => g.gate === 'G5')?.status).toBe('UNVERIFIED');
    expect(r.gates.find((g) => g.gate === 'G6')?.status).toBe('UNVERIFIED');
    expect(r.summary.capacity.withMediaRooms).toBe(0);
  });

  it('continuous team release can be ready while public/MVP acceptance is incomplete', () => {
    const f = fixture();
    f.patch('release.json', { audience: 'team-only' });
    const r = f.evaluate({
      ...f.manifest,
      gates: f.manifest.gates.map((g) => (g.gate === 'G5' ? { ...g, status: 'NOT_RUN' } : g)),
    });
    expect(r.release).toMatchObject({
      ready: true,
      audience: 'team-only',
      operatingMode: 'continuous',
    });
    expect(r.summary.mvpComplete).toBe(false);
    expect(r.publication.allowed).toBe(false);
    expect(r.publication.problems).toContain(
      'team access restriction retained or audience unknown',
    );
  });

  it('attested mode needs valid current official dates; continuous does not use that expiry', () => {
    const f = fixture();
    for (const patch of [
      { operatingMode: 'attested' },
      { operatingMode: 'attested', officialBudgetCheckedAt: 'bad', officialBudgetExpiresAt: 'bad' },
      {
        operatingMode: 'attested',
        officialBudgetCheckedAt: new Date(NOW - 10000).toISOString(),
        officialBudgetExpiresAt: new Date(NOW - 1).toISOString(),
      },
    ]) {
      f.patch('release.json', patch);
      expect(f.evaluate().release.ready).toBe(false);
    }
    f.patch('release.json', {
      officialBudgetCheckedAt: new Date(NOW - 10000).toISOString(),
      officialBudgetExpiresAt: new Date(NOW + 10000).toISOString(),
    });
    expect(f.evaluate().release.ready).toBe(true);
    f.patch('release.json', { operatingMode: 'continuous', officialBudgetExpiresAt: 'bad' });
    expect(f.evaluate().release.ready).toBe(true);
  });

  it('a failed cleanup or foreign release cannot be overridden by manifest booleans', () => {
    for (const patch of [
      { smokeCleanupConfirmed: false },
      { unresolvedRetirements: 1 },
      { sourceCommit: 'f'.repeat(40) },
      { readiness: 'LOCKED' },
      { serviceBudgetStatus: 'unknown' },
    ]) {
      const f = fixture();
      f.patch('release.json', patch);
      expect(
        f.evaluate({
          ...f.manifest,
          publication: {
            ...f.manifest.publication,
            smokeCleanupConfirmed: true,
            unresolvedRetirements: 0,
            resumeOpenConfirmed: true,
          },
        }).publication.allowed,
      ).toBe(false);
    }
  });

  it('report replacement remains idempotent and shows release/public acceptance separately', () => {
    const f = fixture();
    const result = f.evaluate();
    const once = injectReport('# doc', renderReport(result, f.manifest, 'first'));
    const twice = injectReport(once, renderReport(result, f.manifest, 'second'));
    expect(twice.match(/mvp-gate-report:start/g)).toHaveLength(1);
    expect(twice).toContain('생성 second');
    expect(twice).toContain('운영 배포 준비');
  });
});

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    if (!dir.startsWith(join(tmpdir(), 'kk-gate-evidence-'))) throw new Error('UNSAFE_TEST_PATH');
    rmSync(dir, { recursive: true, force: true });
  }
});
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kk-gate-evidence-'));
  temporary.push(dir);
  return dir;
};
describe('actual evidence file and CLI boundary', () => {
  it('hashes actual bytes and rejects directories, malformed JSON, traversal and symlink escape', () => {
    const dir = directory();
    const outside = directory();
    writeFileSync(join(dir, 'valid.json'), '{"result":"PASS"}');
    writeFileSync(join(dir, 'bad.json'), 'PASS');
    mkdirSync(join(dir, 'folder'));
    writeFileSync(join(outside, 'valid.json'), '{}');
    symlinkSync(outside, join(dir, 'linked'), 'junction');
    const read = createEvidenceReader(dir, dir);
    expect(read('valid.json')).toEqual({
      document: { result: 'PASS' },
      sha256: createHash('sha256').update('{"result":"PASS"}').digest('hex'),
    });
    for (const ref of [
      'bad.json',
      'folder',
      'missing.json',
      '../valid.json',
      'linked/valid.json',
      join(outside, 'valid.json'),
    ])
      expect(read(ref)).toBeNull();
  });

  it('CLI reads its own checkout and lockfile instead of the manifest HEAD', () => {
    const dir = directory();
    const f = fixture();
    for (const [ref, doc] of f.documents) writeFileSync(join(dir, ref), JSON.stringify(doc));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(f.manifest));
    const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts/verify-mvp-evidence.mjs'),
        '--input',
        dir,
        '--gates',
        join(dir, 'manifest.json'),
        '--report',
        join(dir, 'report.md'),
      ],
      { encoding: 'utf8', timeout: 20000, windowsHide: true },
    );
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(readFileSync(join(dir, 'QA-13.json'), 'utf8'));
    expect(report.summary.pass).toBe(0);
    expect(report.summary.mvpComplete).toBe(false);
    expect(readFileSync(join(dir, 'report.md'), 'utf8')).toContain(actual.slice(0, 7));
  });
});
