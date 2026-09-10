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

const SHA = 'a'.repeat(40);
const deviceIds = ['dev-1', 'dev-2', 'dev-3', 'dev-4', 'dev-5', 'dev-6'];

function devices(
  over: (d: Record<string, unknown>, i: number) => Record<string, unknown> = (d) => d,
) {
  return {
    sourceCommit: SHA,
    network: { kind: 'campus-wifi-6e', measured: 'RTT 12ms / 210 Mbps down / 95 Mbps up' },
    devices: deviceIds.map((deviceId, i) =>
      over(
        {
          deviceId,
          realDevice: true,
          model: 'Samsung Galaxy Book 960XGL',
          os: 'Windows 11 Enterprise 26200',
          browser: 'Chrome 152.0.7977',
          camera: 'Intel AVStream',
          preset: i < 4 ? 'mid' : 'low',
          participant: `P${i + 1}`,
          verifiedAt: '2026-09-11T09:50:00+09:00',
        },
        i,
      ),
    ),
  };
}

const perDevice = (over: Partial<Record<string, unknown>> = {}) =>
  Object.fromEntries(
    deviceIds.map((id, i) => [
      id,
      {
        fpsAvg: i < 4 ? 52 : 34,
        fpsMin: i < 4 ? 41 : 28,
        remoteFaces: 5,
        nearVoice: true,
        audioDuplicate: false,
        playbackPermission: 'granted',
        afterEnd: { tracks: 0, workers: 1, textures: 12, rooms: 0 },
        ...over,
      },
    ]),
  );

/** Five matches whose coverage together spans every required behaviour. */
function matches(
  patch: (m: Record<string, unknown>, order: number) => Record<string, unknown> = (m) => m,
) {
  const chunks = [
    REQUIRED_COVERAGE.slice(0, 5),
    REQUIRED_COVERAGE.slice(5, 10),
    REQUIRED_COVERAGE.slice(10, 15),
    REQUIRED_COVERAGE.slice(15, 20),
    REQUIRED_COVERAGE.slice(20),
  ];
  return {
    matches: chunks.map((coverage, i) =>
      patch(
        {
          matchId: `match-${i + 1}`,
          order: i + 1,
          startedAt: `2026-09-11T10:${10 + i * 5}:00+09:00`,
          endedAt: `2026-09-11T10:${13 + i * 5}:20+09:00`,
          result: ['two-captured', 'two-escaped', 'timeout', 'two-captured', 'two-escaped'][i],
          rematch: ['same', 'swap', 'lobby', 'same', 'none'][i],
          coverage,
          devices: perDevice(),
          failures: [],
        },
        i + 1,
      ),
    ),
  };
}

describe('six-device five-match record', () => {
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
