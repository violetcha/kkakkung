// F-18 / QA-12 unit tests on stored synthetic windows: quantiles, the per-minute API window,
// session coverage and gate separation. The default verify never waits 15 minutes or opens a
// Cloud session; the real run is scripts/run-media-load.mjs --stages 10 ... (QA-12 case).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadIntegratedEvidence } from '../../scripts/summarize-integrated-load.mjs';
import {
  TEN_ROOM_SCHEDULE,
  TEN_ROOM_TARGET,
  evaluateIntegrated,
  type IntegratedWindow,
} from './TenRoomSchedule.ts';

import { allRequirements, run, latency, window, input } from '../fixtures/integrated-evidence.js';

describe('schedule data', () => {
  it('covers the four §26.2 segments back to back over 900 s with 60 sessions in 10 rooms', () => {
    expect(TEN_ROOM_TARGET).toMatchObject({
      rooms: 10,
      sessions: 60,
      durationSeconds: 900,
      participantMinutes: 900,
      planningMinutes: 300,
    });
    expect(TEN_ROOM_SCHEDULE.map((s) => [s.fromSecond, s.toSecond])).toEqual([
      [0, 180],
      [180, 480],
      [480, 660],
      [660, 900],
    ]);
    expect(allRequirements.length).toBeGreaterThanOrEqual(9);
  });
});

describe('same-interval G2/G6 judgement', () => {
  it('a full clean run passes every gate with 900 measured sixty-session seconds', () => {
    const s = evaluateIntegrated(input());
    expect(s.gates.map((g) => [g.gate, g.status])).toEqual([
      ['G2', 'PASS'],
      ['G6', 'PASS'],
      ['cleanup', 'PASS'],
    ]);
    expect(s.measuredSixtySeconds).toBe(900);
    expect(s.publishHold).toBe(false);
  });

  it('550 API calls but a 1500 ms p99 block latency fails G2', () => {
    const s = evaluateIntegrated(
      input({ windows: [window(0, { apiCalls: 550, effectLatencyMs: latency(1500) })] }),
    );
    const g2 = s.gates.find((g) => g.gate === 'G2')!;
    expect(g2.status).toBe('FAIL');
    expect(g2.reasons.join(' ')).toMatch(/p99 1500ms/);
  });

  it('latency within limits but 650 API calls fails G2; 900 is never an accepted ceiling', () => {
    const s = evaluateIntegrated(input({ windows: [window(0, { apiCalls: 650 })] }));
    const g2 = s.gates.find((g) => g.gate === 'G2')!;
    expect(g2.status).toBe('FAIL');
    expect(g2.reasons.join(' ')).toMatch(/650\/60s > 600 \(900 is not an accepted ceiling\)/);
  });

  it('sixty idle connections with no movement or policy change do not count as an integrated result (G6)', () => {
    const s = evaluateIntegrated(
      input({ windows: [window(0, { policyChanges: 0, movementCells: 0 })] }),
    );
    const g6 = s.gates.find((g) => g.gate === 'G6')!;
    expect(g6.status).toBe('FAIL');
    expect(g6.reasons).toContain('idle connections only: no movement or policy change');
    const missing = evaluateIntegrated(input({ observedRequirements: allRequirements.slice(1) }));
    expect(missing.gates.find((g) => g.gate === 'G6')!.reasons[0]).toMatch(
      /connect: 60 sessions publish face\+voice not observed/,
    );
  });

  it('after personal ends 54 sessions are a reduced interval reported apart; nobody fills the slots', () => {
    const windows = [
      ...Array.from({ length: 11 }, (_, i) => window(i * 60)),
      ...Array.from({ length: 4 }, (_, i) =>
        window(660 + i * 60, {
          tag: 'reduced',
          concurrentSessions: 54,
          rooms: window(0).rooms.slice(0, 9),
        }),
      ),
    ];
    const s = evaluateIntegrated(input({ windows }));
    expect(s.normalWindows).toBe(11);
    expect(s.reducedWindows).toBe(4);
    expect(s.measuredSixtySeconds).toBe(660);
    expect(s.gates.find((g) => g.gate === 'G2')!.status).toBe('PASS');
    expect(s.gates.find((g) => g.gate === 'G6')!.status).toBe('FAIL');
    expect(s.publishHold).toBe(true);
  });

  it('one UNRESOLVED retirement after 15 minutes keeps cleanup failed and holds publication, even with G2/G6 passing', () => {
    const s = evaluateIntegrated(input({ unresolvedRetirements: 1 }));
    expect(s.gates.find((g) => g.gate === 'cleanup')).toMatchObject({
      status: 'FAIL',
      reasons: ['1 unresolved retirements'],
    });
    expect(s.publishHold).toBe(true);
    const unreconciled = evaluateIntegrated(input({ officialAfter: null }));
    expect(unreconciled.publishHold).toBe(true);
  });

  it('destructive windows (SIGKILL, 2 s stall) are tagged apart and never counted as sixty-session time', () => {
    const s = evaluateIntegrated(
      input({ windows: [window(0), window(60, { tag: 'destructive' })] }),
    );
    expect(s.destructiveWindows).toBe(1);
    expect(s.measuredSixtySeconds).toBe(60);
  });

  it('60 s and 899 s cannot certify the 900 s target', () => {
    for (const windows of [
      [window(0)],
      [...input().windows.slice(0, 14), window(840, { durationSeconds: 59, tag: 'transitional' })],
    ]) {
      const summary = evaluateIntegrated(input({ windows }));
      expect(summary.measuredSixtySeconds).toBe(windows.length === 1 ? 60 : 899);
      expect(summary.gates.find((gate) => gate.gate === 'G6')?.status).toBe('FAIL');
      expect(summary.publishHold).toBe(true);
    }
  });

  it('records a reconnect gap separately and requires replacement measurement time, not replacement players', () => {
    const windows = [
      ...input().windows.slice(0, 8),
      window(480, { tag: 'reduced', concurrentSessions: 54, rooms: window(0).rooms.slice(0, 9) }),
      ...Array.from({ length: 7 }, (_, i) => window(540 + i * 60)),
    ];
    const summary = evaluateIntegrated(input({ windows }));
    expect(summary.measuredSixtySeconds).toBe(900);
    expect(summary.reducedWindows).toBe(1);
    expect(summary.gates.every((gate) => gate.status === 'PASS')).toBe(true);
  });

  it('does not accept partial API minutes or a failed API gate for publication', () => {
    const partial = evaluateIntegrated(input({ windows: [window(0, { durationSeconds: 59 })] }));
    expect(partial.gates[0]?.reasons).toContain(
      'partial normal window cannot certify the 60s management API limit',
    );
    const badApi = evaluateIntegrated(
      input({ windows: input().windows.map((w) => window(w.atSecond, { apiCalls: 601 })) }),
    );
    expect(badApi.gates.find((gate) => gate.gate === 'G6')?.status).toBe('PASS');
    expect(badApi.publishHold).toBe(true);
  });

  it.each([
    ['duplicates', Array.from({ length: 15 }, () => window(0))],
    ['overlap', [window(0), window(30), ...input().windows.slice(2)]],
    ['missing time', [window(0), ...input().windows.slice(2)]],
    ['missing origin', input().windows.map((w) => ({ ...w, atSecond: w.atSecond + 60 }))],
  ])('rejects %s instead of multiplying window count by 60', (_, windows) => {
    const summary = evaluateIntegrated(input({ windows }));
    expect(summary.measuredSixtySeconds).toBe(0);
    expect(summary.gates.every((gate) => gate.status === 'FAIL')).toBe(true);
    expect(summary.publishHold).toBe(true);
  });

  it.each([
    ['one room extrapolated', { rooms: window(0).rooms.slice(0, 1) }],
    [
      'one room with 60 participants',
      {
        rooms: [
          { roomId: 'single', sessionIds: window(0).rooms.flatMap((room) => room.sessionIds) },
        ],
      },
    ],
    ['duplicate room', { rooms: Array.from({ length: 10 }, () => window(0).rooms[0]!) }],
    [
      'duplicated participant',
      {
        rooms: window(0).rooms.map((room) => ({
          ...room,
          sessionIds: ['same', ...room.sessionIds.slice(1)],
        })),
      },
    ],
    ['negative calls', { apiCalls: -1 }],
    ['NaN latency', { effectLatencyMs: [Number.NaN] }],
    ['negative latency', { effectLatencyMs: [-1] }],
    ['infinite time', { atSecond: Number.POSITIVE_INFINITY }],
    ['fractional time', { durationSeconds: 59.5 }],
    ['invented tag', { tag: 'passed' }],
    ['null interval', null],
  ])('rejects malformed measurement: %s', (_, changes) => {
    const windows = input().windows.map((w) => (changes === null ? null : { ...w, ...changes }));
    const summary = evaluateIntegrated(input({ windows: windows as IntegratedWindow[] }));
    expect(summary.gates.every((gate) => gate.status === 'FAIL')).toBe(true);
    expect(summary.publishHold).toBe(true);
  });

  it('keeps G2/G6 distinct from invalid accounting and rejects missing or negative usage', () => {
    for (const officialAfter of [
      null,
      { remainingMinutes: -1, remainingBytes: 100, checkedAtEpochMs: 1 },
      { remainingMinutes: 100, remainingBytes: Number.NaN, checkedAtEpochMs: 1 },
      { remainingMinutes: 100, remainingBytes: 100, checkedAtEpochMs: 0 },
    ]) {
      const summary = evaluateIntegrated(input({ officialAfter }));
      expect(summary.gates.map((gate) => gate.status)).toEqual(['PASS', 'PASS', 'FAIL']);
      expect(summary.publishHold).toBe(true);
    }
    for (const unresolvedRetirements of [-1, Number.NaN, 0.5])
      expect(evaluateIntegrated(input({ unresolvedRetirements })).publishHold).toBe(true);
  });

  it('rejects measurement time outside the actual run and official usage observed before it ended', () => {
    const shortRun = evaluateIntegrated(
      input({ run: { ...run, endedAtEpochMs: run.startedAtEpochMs + 60_000 } }),
    );
    expect(shortRun.measuredSixtySeconds).toBe(0);
    expect(shortRun.publishHold).toBe(true);
    const staleUsage = evaluateIntegrated(
      input({
        officialAfter: { ...input().officialAfter!, checkedAtEpochMs: run.startedAtEpochMs },
      }),
    );
    expect(staleUsage.gates.map((gate) => gate.status)).toEqual(['PASS', 'PASS', 'FAIL']);
  });

  it('counts rolling minutes across fixed window boundaries so two adjacent bursts cannot hide', () => {
    const windows = input().windows.map((w, i) =>
      i < 2
        ? window(w.atSecond, {
            apiCalls: 500,
            apiRequestAtSeconds: Array.from({ length: 500 }, () => (i === 0 ? 55 : 65)),
          })
        : w,
    );
    const summary = evaluateIntegrated(input({ windows }));
    expect(summary.apiCallsMax).toBeGreaterThanOrEqual(1000);
    expect(summary.gates.find((gate) => gate.gate === 'G2')?.status).toBe('FAIL');
    expect(summary.publishHold).toBe(true);
  });
});

describe('evidence loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa12-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads windows/cleanup/official-after/requirements and treats a missing cleanup file as unresolved', () => {
    writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
    writeFileSync(join(dir, 'windows.json'), JSON.stringify(input().windows));
    writeFileSync(join(dir, 'requirements.json'), JSON.stringify(allRequirements));
    const loaded = loadIntegratedEvidence(dir);
    expect(loaded.input?.unresolvedRetirements).toBe(Number.POSITIVE_INFINITY);
    expect(evaluateIntegrated(loaded.input!).publishHold).toBe(true);
    writeFileSync(join(dir, 'cleanup.json'), JSON.stringify({ unresolvedRetirements: 0 }));
    writeFileSync(
      join(dir, 'official-after.json'),
      JSON.stringify({
        remainingMinutes: 1,
        remainingBytes: 1,
        checkedAtEpochMs: run.endedAtEpochMs,
      }),
    );
    expect(evaluateIntegrated(loadIntegratedEvidence(dir).input!).publishHold).toBe(false);
    expect(loadIntegratedEvidence(tmpdir())).toMatchObject({
      error: expect.stringContaining('windows.json'),
    });
  });

  it('returns a closed error for invalid JSON and malformed interval shapes without echoing file contents', () => {
    writeFileSync(join(dir, 'windows.json'), '{private-corrupt-input');
    expect(loadIntegratedEvidence(dir)).toEqual({
      error: 'windows.json unreadable or invalid JSON',
    });
    writeFileSync(join(dir, 'windows.json'), JSON.stringify([null]));
    expect(loadIntegratedEvidence(dir)).toMatchObject({
      error: expect.stringContaining('invalid object'),
    });
  });

  it('the actual CLI returns 0 only for all gates, 1 for insufficient time, and 3 for corrupt evidence', () => {
    const cliDir = mkdtempSync(join(dir, 'cli-'));
    const evidence = input();
    for (const [file, value] of Object.entries({
      'run.json': evidence.run,
      'windows.json': evidence.windows,
      'requirements.json': evidence.observedRequirements,
      'cleanup.json': { unresolvedRetirements: 0 },
      'official-after.json': evidence.officialAfter,
    }))
      writeFileSync(join(cliDir, file), JSON.stringify(value));
    const invoke = () =>
      spawnSync(
        process.execPath,
        [
          'scripts/summarize-integrated-load.mjs',
          '--input',
          cliDir,
          '--output',
          join(cliDir, 'summary.json'),
        ],
        { encoding: 'utf8' },
      );
    expect(invoke().status).toBe(0);
    writeFileSync(join(cliDir, 'windows.json'), JSON.stringify([window(0)]));
    const insufficient = invoke();
    expect(insufficient.status).toBe(1);
    expect(insufficient.stdout).toContain('G6=FAIL');
    expect(insufficient.stdout).toContain('publishHold=true');
    writeFileSync(join(cliDir, 'windows.json'), '{corrupt');
    const corrupt = invoke();
    expect(corrupt.status).toBe(3);
    expect(corrupt.stderr).toContain('BLOCKED: windows.json unreadable or invalid JSON');
  });
});
