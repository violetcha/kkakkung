import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INITIAL_USAGE_STATE,
  analyticsWindow,
  collectUsage,
  decideUsage,
  formatFailureNotice,
  formatUsageNotice,
  mergeUsage,
  monthPeriodId,
  summarizeUsage,
  thresholdsFromEnv,
} from '../../scripts/check-livekit-usage.mjs';

const thresholds = { allowanceMinutes: 5000, warningMinutes: 4000, criticalMinutes: 4500 };
const at = Date.parse('2026-09-21T12:00:00Z');

describe('LiveKit usage monitor', () => {
  it('uses a current-month id and a seven-day-safe Analytics window', () => {
    expect(monthPeriodId(at)).toBe('2026-09');
    expect(analyticsWindow(at)).toEqual({ start: '2026-09-15', end: '2026-09-21' });
  });

  it('requires ordered thresholds instead of silently assuming the plan allowance', () => {
    expect(
      thresholdsFromEnv({
        LIVEKIT_PARTICIPANT_MINUTES_ALLOWANCE: '5000',
        LIVEKIT_PARTICIPANT_MINUTES_WARNING: '4000',
        LIVEKIT_PARTICIPANT_MINUTES_CRITICAL: '4500',
      }),
    ).toEqual(thresholds);
    expect(() =>
      thresholdsFromEnv({
        LIVEKIT_PARTICIPANT_MINUTES_ALLOWANCE: '5000',
        LIVEKIT_PARTICIPANT_MINUTES_WARNING: '4500',
        LIVEKIT_PARTICIPANT_MINUTES_CRITICAL: '4000',
      }),
    ).toThrow('INVALID_THRESHOLD');
  });

  it('keeps the greatest provider value per session and survives a restart', () => {
    const first = mergeUsage(
      INITIAL_USAGE_STATE,
      '2026-09',
      [{ sessionId: 's1', minutes: 12 }],
      at,
      100,
    );
    const second = mergeUsage(
      first,
      '2026-09',
      [
        { sessionId: 's1', minutes: 8 },
        { sessionId: 's1', minutes: 15 },
        { sessionId: 's2', minutes: 5 },
      ],
      at + 1,
    );
    expect(summarizeUsage(second, at, thresholds)).toMatchObject({
      baselineMinutes: 100,
      observedMinutes: 120,
      remainingMinutes: 4880,
    });
  });

  it('starts a new monthly ledger at zero rather than carrying old quota across the reset', () => {
    const previous = mergeUsage(
      INITIAL_USAGE_STATE,
      '2026-08',
      [{ sessionId: 'old', minutes: 4900 }],
      Date.parse('2026-08-31T23:00:00Z'),
      0,
    );
    const current = mergeUsage(previous, '2026-09', [], at, 0);
    expect(summarizeUsage(current, at, thresholds)).toMatchObject({
      periodId: '2026-09',
      observedMinutes: 0,
      remainingMinutes: 5000,
      level: 'normal',
    });
  });

  it('notifies on threshold transitions and does not auto-lock admission', () => {
    const current = mergeUsage(
      INITIAL_USAGE_STATE,
      '2026-09',
      [{ sessionId: 's1', minutes: 4500 }],
      at,
      0,
    );
    const result = decideUsage(INITIAL_USAGE_STATE, current, at, { thresholds });
    expect(result.notices.map((notice) => notice.kind)).toEqual(['CRITICAL']);
    expect(result.notices[0]!.text).toContain('4500/5000분');
    expect(result.notices[0]!.text).toContain('자동으로 입장을 차단하지 않는다');
  });

  it('fetches sessions and details with a roomList-grant token without recording identities', async () => {
    const calls: string[] = [];
    const result = await collectUsage({
      projectId: 'p_project-204',
      apiKey: 'key',
      apiSecret: 'secret',
      nowMs: at,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/sessions?'))
          return new Response(JSON.stringify({ sessions: [{ sessionId: 'session-1' }] }), {
            status: 200,
          });
        return new Response(
          JSON.stringify({
            connectionMinutes: 37,
            participants: [{ participantIdentity: 'private' }],
          }),
          {
            status: 200,
          },
        );
      },
    });
    expect(result.records).toEqual([{ sessionId: 'session-1', minutes: 37 }]);
    expect(calls[0]).toContain('start=2026-09-15');
    expect(calls[0]).toContain('end=2026-09-21');
    expect(calls[1]).toContain('/sessions/session-1');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('keeps notices free of credentials and provider URLs', () => {
    const text = `${formatUsageNotice(
      {
        periodId: '2026-09',
        baselineMinutes: 0,
        observedMinutes: 4500,
        remainingMinutes: 500,
        level: 'critical',
        lastSuccessfulAtMs: at,
      },
      { thresholds, source: 'Analytics API' },
    )}\n${formatFailureNotice('ANALYTICS_UNAUTHORIZED')}`;
    expect(text).not.toMatch(/https?:\/\/|secret|token|identity/i);
  });

  it('supports a dry-run notification test without credentials', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const script = resolve(root, 'scripts/check-livekit-usage.mjs');
    const result = spawnSync(process.execPath, [script, '--test', '--label', 'dry'], {
      env: { ...process.env, MM_WEBHOOK: '', LIVEKIT_USAGE_DRY_RUN: '1' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('LiveKit 사용량 알림 경로 시험');
  });

  it('does not start a real check without a first-run dashboard baseline', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const script = resolve(root, 'scripts/check-livekit-usage.mjs');
    const result = spawnSync(
      process.execPath,
      [script, '--state', resolve(tmpdir(), 'missing-usage-state.json')],
      {
        env: {
          ...process.env,
          MM_WEBHOOK: '',
          LIVEKIT_USAGE_DRY_RUN: '1',
          LIVEKIT_PARTICIPANT_MINUTES_ALLOWANCE: '5000',
          LIVEKIT_PARTICIPANT_MINUTES_WARNING: '4000',
          LIVEKIT_PARTICIPANT_MINUTES_CRITICAL: '4500',
          LIVEKIT_USAGE_BASELINE_MINUTES: '',
        },
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('LIVEKIT_USAGE_BASELINE_MINUTES');
  });

  it('ships a host-side Jenkins job with separate credentials and no secret echo', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const job = readFileSync(resolve(root, 'infra/jenkins/livekit-usage.Jenkinsfile'), 'utf8');
    expect(job).toContain("triggers { cron('H/30 * * * *') }");
    expect(job).toContain("credentialsId: 'livekit-api-key'");
    expect(job).toContain("credentialsId: 'livekit-api-secret'");
    expect(job).toContain("credentialsId: 'livekit-project-id'");
    expect(job).toContain("credentialsId: 'livekit-usage-baseline-minutes'");
    expect(job).toContain("credentialsId: 'mattermost-webhook'");
    expect(job).toContain('node scripts/check-livekit-usage.mjs --state');
    expect(job).not.toMatch(/echo[^\n]*(LIVEKIT|MM_WEBHOOK)|set -x/);
  });
});
