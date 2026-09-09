import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadCapabilityReport,
  parseCapabilityReport,
} from '../../src/media/CloudCapabilityProbe.js';

// Synthetic parser input: never copied to OPS_DATA_DIR or presented as a Cloud result.
const fixture = () => ({
  status: 'SUPPORTED',
  sdkVersion: '2.18.0',
  cloudProjectAlias: 'synthetic-test-project',
  namespace: 'synthetic-test-namespace',
  testedAtEpochMs: 1_000,
  grantProfile: {
    roomJoin: true,
    room: 'synthetic-test-namespace-probe',
    canPublishData: false,
    canSubscribe: false,
    canPublishSources: ['camera', 'microphone'],
    roomAdmin: false,
    roomRecord: false,
    roomCreate: false,
    roomList: false,
  },
  revocationProfile: {
    mode: 'explicit-cutoff',
    bufferSeconds: 2,
    maxObservedClockOffsetMs: 500,
  },
  allowReceived: true,
  forbiddenRejected: true,
  revocationVerified: true,
  evidenceRefs: ['synthetic-evidence/allow.json', 'synthetic-evidence/revocation.json'],
});

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe('capability report input validation (local only)', () => {
  it('requires all observed boundaries and both validated profiles for SUPPORTED', () => {
    expect(parseCapabilityReport(fixture()).status).toBe('SUPPORTED');
    for (const field of ['allowReceived', 'forbiddenRejected', 'revocationVerified']) {
      expect(() => parseCapabilityReport({ ...fixture(), [field]: false })).toThrow(
        'supportedEvidence',
      );
    }
    for (const field of ['grantProfile', 'revocationProfile']) {
      expect(() => parseCapabilityReport({ ...fixture(), [field]: null })).toThrow(
        'supportedEvidence',
      );
    }
    expect(() => parseCapabilityReport({ ...fixture(), evidenceRefs: [] })).toThrow(
      'supportedEvidence',
    );
    expect(() => parseCapabilityReport({ status: 'SUPPORTED' })).toThrow('report');
  });

  it('accepts an explicit blocked report without upgrading it', () => {
    const report = parseCapabilityReport({
      ...fixture(),
      status: 'BLOCKED',
      grantProfile: null,
      revocationProfile: null,
      allowReceived: false,
      forbiddenRejected: false,
      revocationVerified: false,
      evidenceRefs: [],
    });
    expect(report.status).toBe('BLOCKED');
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('rejects privilege widening, source expansion, and unknown or secret fields', () => {
    for (const field of ['roomAdmin', 'roomRecord', 'roomList', 'roomCreate', 'canSubscribe']) {
      expect(() =>
        parseCapabilityReport({
          ...fixture(),
          grantProfile: { ...fixture().grantProfile, [field]: true },
        }),
      ).toThrow('grantProfile');
    }
    expect(() =>
      parseCapabilityReport({
        ...fixture(),
        grantProfile: { ...fixture().grantProfile, canPublishSources: ['camera', 'screen_share'] },
      }),
    ).toThrow('grantProfile');
    expect(() => parseCapabilityReport({ ...fixture(), token: 'forbidden' })).toThrow('report');
    for (const ref of ['https://evidence/?token=secret', '../escape.json', 'eyJx.abcd.efgh']) {
      expect(() => parseCapabilityReport({ ...fixture(), evidenceRefs: [ref] })).toThrow(
        'evidenceRefs',
      );
    }
  });

  it('rejects a cutoff outside the permitted clock window and nonfinite timestamps', () => {
    expect(() =>
      parseCapabilityReport({
        ...fixture(),
        revocationProfile: { ...fixture().revocationProfile, bufferSeconds: 60 },
      }),
    ).toThrow('clockWindow');
    expect(() => parseCapabilityReport({ ...fixture(), testedAtEpochMs: Infinity })).toThrow(
      'testedAtEpochMs',
    );
  });

  it('keeps missing, malformed, mismatched, future and changed-profile reports locked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kkakkung-capability-'));
    temporaryDirectories.push(dir);
    const options = {
      opsDataDir: dir,
      projectAlias: 'synthetic-test-project',
      namespace: 'synthetic-test-namespace',
      nowEpochMs: 2_000,
    };
    await expect(loadCapabilityReport(options)).resolves.toMatchObject({
      status: 'blocked',
      reasons: ['CAPABILITY_REPORT_MISSING'],
    });
    await writeFile(join(dir, 'capability-report.json'), '{');
    expect((await loadCapabilityReport(options)).status).toBe('blocked');
    await writeFile(join(dir, 'capability-report.json'), JSON.stringify(fixture()));
    expect((await loadCapabilityReport(options)).status).toBe('supported');
    for (const override of [
      { projectAlias: 'different' },
      { namespace: 'different' },
      { sdkVersion: '0.0.0' },
      { nowEpochMs: 999 },
      {
        expectedRevocationProfile: {
          mode: 'sdk-default' as const,
          bufferSeconds: 2,
          maxObservedClockOffsetMs: 500,
        },
      },
    ]) {
      expect((await loadCapabilityReport({ ...options, ...override })).status).toBe('blocked');
    }
  });
});
