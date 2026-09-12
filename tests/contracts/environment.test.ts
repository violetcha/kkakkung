// F-01 / DP-01 local contract tests. These prove the QA discovery, Cloud isolation and
// preflight/runner rules without touching Cloud, devices or the network.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import defaultConfig from '../../vitest.config.ts';
import cloudConfig from '../../vitest.cloud.config.ts';
import {
  CLOUD_CASES,
  NON_CLOUD_CASES,
  PreflightError,
  caseTimeoutMs,
  parseCloudPreflight,
  requireCloudPreflight,
} from '../cloud/CloudPreflight.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const now = 1_757_300_000_000;

function validPreflight(overrides: Record<string, unknown> = {}) {
  return {
    projectAlias: 'kkakkung-test',
    namespace: 'kkakkung-qa',
    sourceCommit: 'abc123',
    lockfileHash: 'deadbeef',
    checkedAtEpochMs: now - 60_000,
    expiresAtEpochMs: now + 3_600_000,
    remainingMinutes: 1200,
    remainingBytes: 50_000_000_000,
    allowedCases: ['MC-01', 'QA-02'],
    budgetReservation: { reservationId: 'r-1', participantMinutes: 100, bytes: 1_000_000_000 },
    credentialEnvNames: ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    deviceManifest: { path: 'package.json', mode: 'synthetic' },
    evidenceDir: '.local/qa/MC-01',
    maxRooms: 1,
    maxParticipants: 3,
    maxDurationSeconds: 600,
    cleanupAllowanceSeconds: 120,
    ...overrides,
  };
}
const ctx = {
  expectedCase: 'MC-01' as const,
  nowEpochMs: now,
  root,
  env: { LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' },
};

describe('vitest discovery keeps Cloud cases out of the default suite', () => {
  it('includes root contract and load tests and excludes *.cloud.test.ts by default', () => {
    const test = (defaultConfig as { test: { include: string[]; exclude: string[] } }).test;
    expect(test.include).toContain('tests/contracts/**/*.test.ts');
    expect(test.include).toContain('tests/load/**/*.test.ts');
    expect(test.exclude).toContain('**/*.cloud.test.ts');
  });
  it('cloud config lists only the two Cloud locations with a single worker and bounded timeouts', () => {
    const test = (
      cloudConfig as {
        test: {
          include: string[];
          maxWorkers: number;
          fileParallelism: boolean;
          testTimeout: number;
          hookTimeout: number;
        };
      }
    ).test;
    expect(test.include).toEqual([
      'server/test/media/**/*.cloud.test.ts',
      'tests/cloud/**/*.cloud.test.ts',
    ]);
    expect(test.maxWorkers).toBe(1);
    expect(test.fileParallelism).toBe(false);
    expect(test.testTimeout).toBe(120000);
    expect(test.hookTimeout).toBe(30000);
  });
  it('fixes the Cloud case allowlist to exactly one file per case', () => {
    expect(Object.keys(CLOUD_CASES).sort()).toEqual(
      [
        'DP-06',
        'MC-01',
        'MC-PUBLIC-01',
        'QA-02',
        'QA-03',
        'QA-04',
        'QA-05',
        'QA-06',
        'QA-08',
        'QA-09',
        'QA-11',
        'QA-12',
      ].sort(),
    );
    expect(new Set(Object.values(CLOUD_CASES)).size).toBe(Object.keys(CLOUD_CASES).length);
    expect(NON_CLOUD_CASES).toEqual(['QA-01', 'QA-07', 'QA-10', 'QA-13']);
    for (const file of Object.values(CLOUD_CASES))
      expect(file.endsWith('.cloud.test.ts')).toBe(true);
  });
});

describe('CloudPreflight parser', () => {
  it('accepts a complete document and freezes it', () => {
    const p = parseCloudPreflight(validPreflight(), ctx);
    expect(Object.isFrozen(p)).toBe(true);
    expect(caseTimeoutMs(p)).toBe(720_000);
  });
  it.each([
    ['unknown field', { extra: 1 }],
    ['missing case', { allowedCases: ['QA-02'] }],
    ['unregistered case', { allowedCases: ['MC-01', 'QA-01'] }],
    ['empty cases', { allowedCases: [] }],
    ['expired', { expiresAtEpochMs: now - 1 }],
    ['checked in future', { checkedAtEpochMs: now + 1 }],
    ['negative minutes', { remainingMinutes: -1 }],
    [
      'reservation over budget',
      { budgetReservation: { reservationId: 'r', participantMinutes: 5000, bytes: 1 } },
    ],
    ['evidence outside .local/qa', { evidenceDir: 'evidence/MC-01' }],
    ['evidence traversal', { evidenceDir: '.local/qa/../secret' }],
    [
      'device manifest missing file',
      { deviceManifest: { path: 'does-not-exist.json', mode: 'synthetic' } },
    ],
    ['device manifest bad mode', { deviceManifest: { path: 'package.json', mode: 'real' } }],
    ['too many participants per room', { maxRooms: 1, maxParticipants: 7 }],
    ['zero duration', { maxDurationSeconds: 0 }],
    ['cost exceeds reservation', { maxParticipants: 6, maxDurationSeconds: 3600 }],
    ['stage durations outside QA-11', { stageDurationSeconds: { '1': 60, '3': 60, '5': 60 } }],
    ['credential name not uppercase', { credentialEnvNames: ['livekit_api_key'] }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => parseCloudPreflight(validPreflight(overrides), ctx)).toThrow(PreflightError);
  });
  it('rejects when a listed credential is not set, without echoing values', () => {
    let message = '';
    try {
      parseCloudPreflight(validPreflight(), {
        ...ctx,
        env: { LIVEKIT_API_KEY: 'super-secret-value' },
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('LIVEKIT_API_SECRET is not set');
    expect(message).not.toContain('super-secret-value');
  });
  it('rejects a checkout or lockfile mismatch', () => {
    expect(() => parseCloudPreflight(validPreflight(), { ...ctx, sourceCommit: 'other' })).toThrow(
      /sourceCommit/,
    );
    expect(() => parseCloudPreflight(validPreflight(), { ...ctx, lockfileHash: 'other' })).toThrow(
      /lockfileHash/,
    );
  });
  it('requires representative devices for QA-02 and QA-09', () => {
    expect(() =>
      parseCloudPreflight(
        validPreflight({ allowedCases: ['QA-02'], evidenceDir: '.local/qa/QA-02' }),
        {
          ...ctx,
          expectedCase: 'QA-02',
        },
      ),
    ).toThrow(/representative/);
  });
  it('requires stage durations for QA-11 only', () => {
    const base = validPreflight({ allowedCases: ['QA-11'], evidenceDir: '.local/qa/QA-11' });
    const c = { ...ctx, expectedCase: 'QA-11' as const };
    expect(() => parseCloudPreflight(base, c)).toThrow(/stageDurationSeconds/);
    expect(() =>
      parseCloudPreflight({ ...base, stageDurationSeconds: { '1': 60, '3': 120, '5': 180 } }, c),
    ).not.toThrow();
  });
});

describe('requireCloudPreflight refuses direct Vitest runs', () => {
  it('throws (never skips) without the runner-injected flags', () => {
    expect(() => requireCloudPreflight('MC-01', {}, now, root)).toThrow(/RUN_CLOUD_TESTS/);
    expect(() =>
      requireCloudPreflight('MC-01', { RUN_CLOUD_TESTS: '1', CLOUD_TEST_CASE: 'QA-02' }, now, root),
    ).toThrow(/CLOUD_TEST_CASE/);
  });
  it('accepts a matching preflight file and evidence dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kk-preflight-'));
    const file = join(dir, 'preflight.json');
    writeFileSync(file, JSON.stringify(validPreflight()));
    const p = requireCloudPreflight(
      'MC-01',
      {
        RUN_CLOUD_TESTS: '1',
        CLOUD_TEST_CASE: 'MC-01',
        CLOUD_PREFLIGHT_PATH: file,
        CLOUD_EVIDENCE_DIR: '.local/qa/MC-01',
        LIVEKIT_API_KEY: 'k',
        LIVEKIT_API_SECRET: 's',
      },
      now,
      root,
    );
    expect(p.namespace).toBe('kkakkung-qa');
  });
});

describe('run-cloud-check runner', () => {
  const script = resolve(root, 'scripts/run-cloud-check.mjs');
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('exits nonzero and BLOCKED for a non-Cloud case without any network call', () => {
    const r = run(['--case', 'QA-01', '--preflight', 'x.json', '--evidence', '.local/qa/QA-01']);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/BLOCKED/);
    expect(r.stderr).toMatch(/not a Cloud case/);
  });
  it('exits nonzero for an unregistered case', () => {
    const r = run(['--case', 'ZZ-99', '--preflight', 'x.json', '--evidence', '.local/qa/ZZ-99']);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/allowlist/);
  });
  it('ships a test file for every registered Cloud case', () => {
    for (const file of Object.values(CLOUD_CASES))
      expect(existsSync(resolve(root, file))).toBe(true);
  });
  it('blocks a registered case whose test file has not been handed over', () => {
    // Every case has a file in this tree, so point the runner at an empty root.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'kkakkung-empty-root-'));
    const r = spawnSync(
      process.execPath,
      [script, '--case', 'QA-11', '--preflight', 'x.json', '--evidence', '.local/qa/QA-11'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, KKAKKUNG_QA_ROOT: emptyRoot },
      },
    );
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/not been handed over/);
  });
  it('requires all three arguments', () => {
    const r = run(['--case', 'MC-01']);
    expect(r.status).toBe(2);
  });
});

describe('check-execution-environment reports names only', () => {
  it('never prints the value of a set variable', () => {
    const script = resolve(root, 'scripts/check-execution-environment.mjs');
    const r = spawnSync(process.execPath, [script, '--facts', 'does-not-exist.json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        OPS_TOKEN: 'ops-secret-value-123',
        LIVEKIT_API_SECRET: 'lk-secret-value-456',
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('ops-secret-value-123');
    expect(r.stdout).not.toContain('lk-secret-value-456');
    expect(r.stdout).toMatch(/toolchainReady/);
  });
});
