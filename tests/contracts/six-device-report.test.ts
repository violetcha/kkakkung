// F-15 / QA-09 report tooling: the manual six-device five-match record is validated for shape,
// coverage, leaks and FPS on synthetic records only. Nothing here is G5 evidence; the real five
// matches on six devices are recorded by people into .local/qa/six-device and judged by the
// same function through scripts/collect-six-device-results.mjs.
import { describe, expect, it } from 'vitest';
import {
  FPS_TARGET,
  PRODUCT_DECISION_PENDING,
  REQUIRED_COVERAGE,
  validateSixDeviceRecords,
} from '../../scripts/collect-six-device-results.mjs';

import { devices, matches, perDevice, SHA } from '../fixtures/six-device-records.js';

describe('six-device five-match record', () => {
  it.each(['not-a-date', '2026-02-30T10:00:00Z', '2026-09-11T10:00:00', '2026-09-11T25:00:00Z'])(
    'does not accept invalid or timezone-free timestamps: %s',
    (invalid) => {
      expect(
        validateSixDeviceRecords({
          devices: devices(),
          matches: matches((m) => ({ ...m, startedAt: invalid })),
        }).status,
      ).not.toBe('PASS');
    },
  );

  it('rejects reversed/overlapping matches, per-match source drift and recorded failures', () => {
    for (const patch of [
      { endedAt: '2026-09-11T09:00:00+09:00' },
      { startedAt: '2026-09-11T10:00:00+09:00' },
      { sourceCommit: 'b'.repeat(40) },
      { failures: [{ stage: 'audio', fixedIn: SHA }] },
    ])
      expect(
        validateSixDeviceRecords({
          devices: devices(),
          matches: matches((m) => ({ ...m, ...patch })),
        }).status,
      ).not.toBe('PASS');
    expect(
      validateSixDeviceRecords({
        devices: devices(),
        matches: { ...matches(), sourceCommit: 'b'.repeat(40) },
      }).status,
    ).toBe('FAIL');
  });

  it('rejects zero faces/voice, missing pair observations and claimed microphone-denied coverage without an actual denied path', () => {
    for (const patch of [
      { devices: perDevice({ remoteFaces: 0, nearVoice: false }) },
      { mediaChecks: [] },
      { devices: perDevice({ microphonePermission: 'granted' }) },
      { devices: perDevice({ micDeniedAction: undefined }) },
    ])
      expect(
        validateSixDeviceRecords({
          devices: devices(),
          matches: matches((m) => ({ ...m, ...patch })),
        }).status,
      ).not.toBe('PASS');
  });

  it('rejects forbidden reception, self/unknown peers and media observations outside the match', () => {
    for (const patch of [
      { allowed: false, observed: true },
      { senderDeviceId: 'dev-1', receiverDeviceId: 'dev-1' },
      { senderDeviceId: 'unknown' },
      { observedAt: '2026-09-11T09:00:00+09:00' },
    ])
      expect(
        validateSixDeviceRecords({
          devices: devices(),
          matches: matches((m) => ({
            ...m,
            mediaChecks: (m.mediaChecks as Record<string, unknown>[]).map((c) => ({
              ...c,
              ...patch,
            })),
          })),
        }).status,
      ).toBe('FAIL');
  });

  it.each([
    { remoteFaces: -1 },
    { remoteFaces: 6 },
    { remoteFaces: 0.5 },
    { afterEnd: { tracks: -1, workers: 0, textures: 0, rooms: 0 } },
  ])('rejects invalid observed counts %j', (patch) => {
    expect(
      validateSixDeviceRecords({
        devices: devices(),
        matches: matches((m) => ({ ...m, devices: perDevice(patch) })),
      }).status,
    ).not.toBe('PASS');
  });

  it('a complete real record passes with 6/6 devices, 5/5 matches and full coverage', () => {
    const r = validateSixDeviceRecords({ devices: devices(), matches: matches() });
    expect(r).toMatchObject({ status: 'PASS', issues: [], incomplete: [] });
    expect(r.summary).toMatchObject({ devices: 6, realDevices: 6, matches: 5 });
    expect(r.summary.coverage).toEqual({
      required: REQUIRED_COVERAGE.length,
      covered: REQUIRED_COVERAGE.length,
      missing: [],
    });
    expect(r.summary.fps['dev-5']).toEqual({ avg: 34, target: FPS_TARGET.low });
  });

  it('six browser contexts on one physical device are not six devices', () => {
    const r = validateSixDeviceRecords({
      devices: devices((d, i) =>
        i === 0 ? d : { ...d, realDevice: false, model: 'browser context on dev-1' },
      ),
      matches: matches(),
    });
    expect(r.status).toBe('FAIL');
    expect(r.issues.filter((x) => x.includes('not a real device'))).toHaveLength(5);
    expect(r.summary.realDevices).toBe(1);
  });

  it('missing sensor/trap/pose coverage fails; an unused undecided item is never a failure', () => {
    const r = validateSixDeviceRecords({
      devices: devices(),
      matches: matches((m) => ({
        ...m,
        coverage: (m.coverage as string[]).filter(
          (t) => !['sensor', 'trap', 'restraint-expiry', 'pose-y'].includes(t),
        ),
      })),
    });
    expect(r.status).toBe('FAIL');
    expect(r.issues.join(' ')).toMatch(/coverage missing: sensor, trap, restraint-expiry, pose-y/);
    // Items still pending a product decision are listed apart and never required.
    const withPending = validateSixDeviceRecords({
      devices: devices(),
      matches: matches((m, order) =>
        order === 1
          ? { ...m, pending: ['EQ-06'], coverage: [...(m.coverage as string[]), 'G3-C'] }
          : m,
      ),
    });
    expect(withPending.status).toBe('PASS');
    expect(withPending.summary.pendingUsed).toEqual(['EQ-06', 'G3-C']);
    for (const id of PRODUCT_DECISION_PENDING) expect(REQUIRED_COVERAGE).not.toContain(id);
  });

  it('leftover workers or textures growing by the fifth match is a leak: completing rematches alone does not pass', () => {
    const r = validateSixDeviceRecords({
      devices: devices(),
      matches: matches((m, order) => ({
        ...m,
        devices: perDevice({
          afterEnd: { tracks: 0, workers: order, textures: 12 + order * 3, rooms: 0 },
        }),
      })),
    });
    expect(r.status).toBe('FAIL');
    expect(r.issues.some((x) => /dev-1: workers grew 1 → 2 .* \(leak\)/.test(x))).toBe(true);
    expect(r.issues.some((x) => /textures grew/.test(x))).toBe(true);
  });

  it('a microphone-denied user is a required path and a passing record, not a failure', () => {
    const r = validateSixDeviceRecords({
      devices: devices(),
      matches: matches((m, order) =>
        order === 1
          ? {
              ...m,
              devices: {
                ...perDevice(),
                'dev-6': {
                  ...perDevice()['dev-6'],
                  nearVoice: true,
                  playbackPermission: 'granted',
                },
              },
            }
          : m,
      ),
    });
    expect(r.status).toBe('PASS');
    expect(REQUIRED_COVERAGE).toContain('mic-denied-user');
    expect(REQUIRED_COVERAGE).toContain('camera-mic-independent');
  });

  it('blank fields are INCOMPLETE and never auto-filled to PASS; a low device under 30 fps and duplicated audio fail', () => {
    const blank = validateSixDeviceRecords({
      devices: devices((d) => ({ ...d, verifiedAt: '' })),
      matches: matches((m) => ({ ...m, result: '' })),
    });
    expect(blank.status).toBe('INCOMPLETE');
    expect(blank.incomplete.length).toBeGreaterThanOrEqual(11);
    expect(blank.issues).toEqual([]);
    const slow = validateSixDeviceRecords({
      devices: devices(),
      matches: matches((m) => ({ ...m, devices: perDevice({ fpsAvg: 27, fpsMin: 20 }) })),
    });
    expect(slow.status).toBe('FAIL');
    expect(slow.issues.some((x) => /dev-1: average fps 27.0 below mid target 45/.test(x))).toBe(
      true,
    );
    const dup = validateSixDeviceRecords({
      devices: devices(),
      matches: matches((m) => ({ ...m, devices: perDevice({ audioDuplicate: true }) })),
    });
    expect(dup.issues.some((x) => /duplicated audio/.test(x))).toBe(true);
    const empty = validateSixDeviceRecords({ devices: {}, matches: {} });
    expect(empty.status).toBe('FAIL');
    expect(empty.issues).toContain('devices: 0 recorded, 6 required');
  });
});
