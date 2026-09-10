// F-18 / QA-12 unit tests on stored synthetic windows: quantiles, the per-minute API window,
// session coverage and gate separation. The default verify never waits 15 minutes or opens a
// Cloud session; the real run is scripts/run-media-load.mjs --stages 10 ... (QA-12 case).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadIntegratedEvidence } from '../../scripts/summarize-integrated-load.mjs';
import {
  TEN_ROOM_SCHEDULE,
  TEN_ROOM_TARGET,
  evaluateIntegrated,
  type IntegratedInput,
  type IntegratedWindow,
} from './TenRoomSchedule.ts';

const allRequirements = TEN_ROOM_SCHEDULE.flatMap((s) => s.required);
const latency = (p99: number) =>
  Array.from({ length: 100 }, (_, i) => (i < 99 ? 100 + i * 2 : p99));

function window(atSecond: number, over: Partial<IntegratedWindow> = {}): IntegratedWindow {
  return {
    atSecond,
    tag: 'normal',
    concurrentSessions: 60,
    apiCalls: 400,
    tooManyRequests: 0,
    effectLatencyMs: latency(600),
    policyChanges: 40,
    movementCells: 300,
    ...over,
  };
}

function input(over: Partial<IntegratedInput> = {}): IntegratedInput {
  return {
    windows: Array.from({ length: 15 }, (_, i) => window(i * 60)),
    unresolvedRetirements: 0,
    officialAfter: { remainingMinutes: 3000, remainingBytes: 1e12, checkedAtEpochMs: 1 },
    observedRequirements: allRequirements,
    ...over,
  };
}

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
        window(660 + i * 60, { tag: 'reduced', concurrentSessions: 54 }),
      ),
    ];
    const s = evaluateIntegrated(input({ windows }));
    expect(s.normalWindows).toBe(11);
    expect(s.reducedWindows).toBe(4);
    expect(s.measuredSixtySeconds).toBe(660);
    expect(s.gates.find((g) => g.gate === 'G2')!.status).toBe('PASS');
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
});

describe('evidence loader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa12-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads windows/cleanup/official-after/requirements and treats a missing cleanup file as unresolved', () => {
    writeFileSync(join(dir, 'windows.json'), JSON.stringify([window(0)]));
    writeFileSync(join(dir, 'requirements.json'), JSON.stringify(allRequirements));
    const loaded = loadIntegratedEvidence(dir);
    expect(loaded.input?.unresolvedRetirements).toBe(Number.POSITIVE_INFINITY);
    expect(evaluateIntegrated(loaded.input!).publishHold).toBe(true);
    writeFileSync(join(dir, 'cleanup.json'), JSON.stringify({ unresolvedRetirements: 0 }));
    writeFileSync(
      join(dir, 'official-after.json'),
      JSON.stringify({ remainingMinutes: 1, remainingBytes: 1, checkedAtEpochMs: 1 }),
    );
    expect(evaluateIntegrated(loadIntegratedEvidence(dir).input!).publishHold).toBe(false);
    expect(loadIntegratedEvidence(tmpdir())).toMatchObject({
      error: expect.stringContaining('windows.json'),
    });
  });
});
