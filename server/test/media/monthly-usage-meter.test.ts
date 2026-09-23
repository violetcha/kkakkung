import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MonthlyUsageMeter,
  cycleStartFor,
  fileMonthlyUsageStore,
  validateMonthlyUsageConfig,
  type MonthlyUsageConfig,
  type MonthlyUsageState,
} from '../../src/media/MonthlyUsageMeter.js';

// S15P21C204-364. 월 참가자-분이 바닥나기 전에 새 경기만 멈춘다.
const MINUTE = 60_000;
const baselineAt = Date.UTC(2026, 8, 23, 1, 0, 0); // 2026-09-23 01:00 UTC
const config: MonthlyUsageConfig = {
  limitMinutes: 5000,
  reserveMinutes: 300,
  baselineMinutes: 1307,
  baselineAtEpochMs: baselineAt,
  cycleDay: 1,
};

function memoryStore(initial: MonthlyUsageState | null = null) {
  let saved = initial;
  let writes = 0;
  return {
    store: {
      read: () => saved,
      write: (state: MonthlyUsageState) => {
        saved = state;
        writes += 1;
      },
    },
    saved: () => saved,
    writes: () => writes,
  };
}

function clockAt(start: number) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms), set: (at: number) => (now = at) };
}

describe('monthly LiveKit usage meter', () => {
  it('starts from the dashboard baseline and counts connected participants over time', () => {
    const clock = clockAt(baselineAt + MINUTE);
    const meter = new MonthlyUsageMeter(config, memoryStore().store, clock.now);
    expect(meter.snapshot()).toMatchObject({ usedMinutes: 1307, remainingMinutes: 3693 });
    meter.observe(6); // 첫 관측은 시계만 건다
    for (let i = 0; i < 40; i++) {
      clock.advance(250);
      meter.observe(6);
    }
    // 6명 × 10초 = 1분(올림)
    expect(meter.snapshot().usedMinutes).toBe(1308);
    for (let i = 0; i < 240 * 5; i++) {
      clock.advance(250);
      meter.observe(6);
    }
    // 6명 × 5분 = 30분이 더해진다(앞의 10초와 합쳐 31분).
    expect(meter.snapshot().usedMinutes).toBe(1307 + 31);
    expect(meter.allowsNewMatch()).toBe(true);
  });

  it('refuses new matches once the remaining minutes fall to the reserve', () => {
    const clock = clockAt(baselineAt);
    const nearly = { ...config, baselineMinutes: 4690 }; // 남은 310분
    const meter = new MonthlyUsageMeter(nearly, memoryStore().store, clock.now);
    expect(meter.allowsNewMatch()).toBe(true);
    meter.observe(10);
    clock.advance(MINUTE);
    meter.observe(10); // 10분 더 씀 → 남은 300분 = 여유
    expect(meter.snapshot()).toMatchObject({ remainingMinutes: 300, blocked: true });
    expect(meter.allowsNewMatch()).toBe(false);
  });

  it('does not count time the baseline already covers, nor a clock that goes back', () => {
    const clock = clockAt(baselineAt - 10 * MINUTE);
    const meter = new MonthlyUsageMeter(config, memoryStore().store, clock.now);
    meter.observe(6);
    clock.set(baselineAt);
    meter.observe(6);
    expect(meter.snapshot().usedMinutes).toBe(1307);
    clock.set(baselineAt - MINUTE);
    meter.observe(6);
    expect(meter.snapshot().usedMinutes).toBe(1307);
  });

  it('starts a new cycle from zero and forgets a baseline read in the previous one', () => {
    const clock = clockAt(baselineAt);
    const meter = new MonthlyUsageMeter(config, memoryStore().store, clock.now);
    meter.observe(6);
    clock.advance(10 * MINUTE);
    meter.observe(6);
    expect(meter.snapshot().usedMinutes).toBe(1367);
    clock.set(Date.UTC(2026, 9, 1, 0, 0, 1)); // 10월 1일 0시 0분 1초
    meter.observe(6);
    // 9월 기준값은 버리고, 경계를 넘은 관측은 새 달에 들어간 1초분만 센다(6명 × 1초 → 1분 올림).
    expect(meter.snapshot()).toMatchObject({
      usedMinutes: 1,
      remainingMinutes: 4999,
      cycleStartEpochMs: Date.UTC(2026, 9, 1),
      blocked: false,
    });
  });

  it('keeps counting across a restart and starts over for a new baseline', () => {
    const memory = memoryStore();
    const clock = clockAt(baselineAt);
    const first = new MonthlyUsageMeter(config, memory.store, clock.now);
    first.observe(6);
    clock.advance(10 * MINUTE);
    first.observe(6);
    first.flush();
    // 같은 기준값으로 다시 뜨면 이어서 센다.
    const again = new MonthlyUsageMeter(config, memory.store, clock.now);
    expect(again.snapshot().usedMinutes).toBe(1367);
    // 운영자가 대시보드를 다시 보고 기준값을 바꾸면 그 값이 앞의 계산을 대신한다.
    const renewed = new MonthlyUsageMeter(
      { ...config, baselineMinutes: 1400, baselineAtEpochMs: clock.now() },
      memory.store,
      clock.now,
    );
    expect(renewed.snapshot().usedMinutes).toBe(1400);
  });

  it('writes at most every thirty seconds and survives a failing disk', () => {
    const memory = memoryStore();
    const clock = clockAt(baselineAt);
    const meter = new MonthlyUsageMeter(config, memory.store, clock.now);
    meter.observe(6);
    for (let i = 0; i < 400; i++) {
      clock.advance(250);
      meter.observe(6);
    }
    // 100초 동안 관측 400번, 쓰기는 30초마다라 네 번 안쪽이다.
    expect(memory.writes()).toBeLessThanOrEqual(4);
    expect(memory.writes()).toBeGreaterThanOrEqual(3);
    const broken = new MonthlyUsageMeter(
      config,
      {
        read: () => null,
        write: () => {
          throw new Error('EIO');
        },
      },
      clock.now,
    );
    expect(() => {
      broken.observe(6);
      clock.advance(31_000);
      broken.observe(6);
    }).not.toThrow();
    expect(broken.snapshot().usedMinutes).toBe(1307 + 4);
  });

  it('rejects a configuration that could never block', () => {
    expect(() => validateMonthlyUsageConfig({ ...config, reserveMinutes: 5000 })).toThrow(
      'INVALID_MONTHLY_RESERVE',
    );
    expect(() => validateMonthlyUsageConfig({ ...config, limitMinutes: 0 })).toThrow();
    expect(() => validateMonthlyUsageConfig({ ...config, cycleDay: 31 })).toThrow();
    expect(() => validateMonthlyUsageConfig({ ...config, baselineMinutes: -1 })).toThrow();
  });

  it('finds the cycle containing a moment for any cycle day', () => {
    expect(cycleStartFor(Date.UTC(2026, 8, 23), 1)).toBe(Date.UTC(2026, 8, 1));
    expect(cycleStartFor(Date.UTC(2026, 8, 10), 15)).toBe(Date.UTC(2026, 7, 15));
    expect(cycleStartFor(Date.UTC(2026, 0, 3), 15)).toBe(Date.UTC(2025, 11, 15));
  });

  it('keeps the count in a file that a restart reads back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monthly-usage-'));
    try {
      const path = join(dir, 'livekit-monthly-usage.json');
      const clock = clockAt(baselineAt);
      const meter = new MonthlyUsageMeter(config, fileMonthlyUsageStore(path), clock.now);
      meter.observe(6);
      clock.advance(10 * MINUTE);
      meter.observe(6);
      meter.flush();
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ countedMs: 60 * MINUTE });
      const again = new MonthlyUsageMeter(config, fileMonthlyUsageStore(path), clock.now);
      expect(again.snapshot().usedMinutes).toBe(1367);
      // 읽을 수 없는 파일은 0 에서 다시 센다(기준값은 그대로 적용된다).
      writeFileSync(path, 'not json');
      const fresh = new MonthlyUsageMeter(config, fileMonthlyUsageStore(path), clock.now);
      expect(fresh.snapshot().usedMinutes).toBe(1307);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
