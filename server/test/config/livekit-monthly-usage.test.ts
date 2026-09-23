/**
 * S15P21C204-364. LiveKit 월 사용량 가드 설정. 한도와 대시보드 기준값은 함께 있어야 뜻이 있다.
 * 여기서는 설정 파싱만 본다.
 */
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/env.js';

const base = { MEDIA_MODE: 'disabled', SERVICE_NAMESPACE: 'kkakkung-test' };

describe('LiveKit monthly usage guard configuration', () => {
  it('is off when neither value is set', () => {
    expect(parseConfig({ ...base }).livekitMonthlyUsage).toBeNull();
  });

  it('reads the plan limit and the dashboard baseline with safe defaults', () => {
    const config = parseConfig({
      ...base,
      LIVEKIT_MONTHLY_MINUTES: '5000',
      LIVEKIT_USAGE_BASELINE: '1307@2026-09-23T01:00:00Z',
    });
    expect(config.livekitMonthlyUsage).toEqual({
      limitMinutes: 5000,
      reserveMinutes: 300,
      baselineMinutes: 1307,
      baselineAtEpochMs: Date.UTC(2026, 8, 23, 1, 0, 0),
      cycleDay: 1,
    });
    const tuned = parseConfig({
      ...base,
      LIVEKIT_MONTHLY_MINUTES: '5000',
      LIVEKIT_USAGE_BASELINE: '0@2026-10-01T00:00:00+09:00',
      LIVEKIT_MONTHLY_RESERVE_MINUTES: '600',
      LIVEKIT_BILLING_CYCLE_DAY: '15',
    });
    expect(tuned.livekitMonthlyUsage).toMatchObject({ reserveMinutes: 600, cycleDay: 15 });
  });

  it('refuses half a configuration instead of guarding from zero', () => {
    expect(() => parseConfig({ ...base, LIVEKIT_MONTHLY_MINUTES: '5000' })).toThrow(
      'must be set together',
    );
    expect(() =>
      parseConfig({ ...base, LIVEKIT_USAGE_BASELINE: '1307@2026-09-23T01:00:00Z' }),
    ).toThrow('must be set together');
  });

  it('refuses a baseline it cannot read and a reserve that could never be reached', () => {
    for (const baseline of ['1307', 'x@2026-09-23T01:00:00Z', '1307@yesterday'])
      expect(
        () =>
          parseConfig({
            ...base,
            LIVEKIT_MONTHLY_MINUTES: '5000',
            LIVEKIT_USAGE_BASELINE: baseline,
          }),
        baseline,
      ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        LIVEKIT_MONTHLY_MINUTES: '5000',
        LIVEKIT_USAGE_BASELINE: '1307@2026-09-23T01:00:00Z',
        LIVEKIT_MONTHLY_RESERVE_MINUTES: '5000',
      }),
    ).toThrow('INVALID_MONTHLY_RESERVE');
    expect(() =>
      parseConfig({
        ...base,
        LIVEKIT_MONTHLY_MINUTES: '5000',
        LIVEKIT_USAGE_BASELINE: '1307@2026-09-23T01:00:00Z',
        LIVEKIT_BILLING_CYCLE_DAY: '31',
      }),
    ).toThrow();
  });
});
