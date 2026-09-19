// S15P21C204-288 external alert delivery contract: only critical AlertPolicy transitions leave
// the host, a flapping condition produces one raise, a raise and clear between two flushes is
// still told, a failed delivery is retried, and no webhook URL ever reaches a message, an error
// or a log line. The policy under test is the real AlertPolicy; nothing here opens a socket.
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../server/src/config/env.ts';
import {
  ALERT_RULES,
  createAlertPolicy,
  type AlertId,
} from '../../server/src/observability/AlertPolicy.ts';
import {
  ALERT_NOTIFY_POLICY,
  AlertDeliveryError,
  NOTIFIED_ALERTS,
  createAlertNotifier,
  createWebhookSender,
  formatAlertNotice,
  type AlertSend,
} from '../../server/src/observability/AlertNotifier.ts';
import type { MetricSample } from '../../server/src/observability/MetricRegistry.ts';
import { EVENT_NAMES, validateEvent } from '../../server/src/observability/StructuredEvents.ts';

const HOOK = 'https://mattermost.example/hooks/abc123secretkey';

function harness(send?: AlertSend) {
  let now = 1_000;
  const sent: string[] = [];
  const failures: [AlertId, string][] = [];
  const notifier = createAlertNotifier({
    now: () => now,
    service: 'kkakkung-test',
    send:
      send ??
      (async (text) => {
        sent.push(text);
      }),
    onFailure: (id, code) => failures.push([id, code]),
  });
  const policy = createAlertPolicy({ now: () => now, onEvent: (event) => notifier.observe(event) });
  const sample = (name: string, value: number): MetricSample => ({
    name,
    value,
    unit: 'count',
    atMs: now,
  });
  /** Flushes until nothing is due, as the one-second loop would over a few seconds. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) {
      notifier.flush();
      await notifier.idle();
    }
  };
  return {
    notifier,
    policy,
    sent,
    failures,
    sample,
    settle,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('which alerts leave the host', () => {
  it('is exactly the critical rules', () => {
    const critical = (Object.keys(ALERT_RULES) as AlertId[]).filter(
      (id) => ALERT_RULES[id].severity === 'critical',
    );
    expect([...NOTIFIED_ALERTS]).toEqual(critical);
    for (const id of [
      'READINESS_LOCKED',
      'MEDIA_API_RATE_LIMITED',
      'JOURNAL_NOT_WRITABLE',
      'MEDIA_RETIREMENT_UNRESOLVED',
      'TICK_OVERLOAD',
    ] as const)
      expect(NOTIFIED_ALERTS).toContain(id);
  });

  it('keeps warnings log-only', async () => {
    const h = harness();
    h.policy.observe(h.sample('media.api.total60s', 900));
    h.policy.observe(h.sample('media.policy.responseLatency', 5000));
    expect(h.policy.active().map((a) => a.id)).toEqual([
      'MEDIA_API_BUDGET_NEAR_LIMIT',
      'MEDIA_POLICY_UNCERTAIN',
    ]);
    await h.settle();
    expect(h.sent).toEqual([]);
  });
});

describe('delivery timing', () => {
  it('delivers a raise once and stays silent while it keeps being observed', async () => {
    const h = harness();
    h.policy.observeReadiness('LOCKED');
    await h.settle();
    for (let i = 0; i < 30; i++) {
      h.advance(1000);
      h.policy.observeReadiness('LOCKED');
      await h.settle();
    }
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('**운영 경보** `READINESS_LOCKED` · kkakkung-test');
  });

  it('holds a clear until it has lasted, so a flap inside the hold is silent', async () => {
    const h = harness();
    h.policy.observeReadiness('LOCKED');
    await h.settle();
    h.policy.observeReadiness('READY');
    h.advance(30_000);
    await h.settle();
    h.policy.observeReadiness('LOCKED');
    h.advance(1000);
    h.policy.observeReadiness('READY');
    h.advance(ALERT_NOTIFY_POLICY.clearHoldMs - 1);
    await h.settle();
    expect(h.sent).toHaveLength(1);
    h.advance(1);
    await h.settle();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain('**경보 해제** `READINESS_LOCKED`');
  });

  it('defers a re-raise inside the cooldown and still delivers it if it lasts', async () => {
    const h = harness();
    h.policy.observeReadiness('LOCKED');
    await h.settle();
    h.policy.observeReadiness('READY');
    h.advance(ALERT_NOTIFY_POLICY.clearHoldMs);
    await h.settle();
    expect(h.sent).toHaveLength(2);
    h.advance(1000);
    h.policy.observeReadiness('LOCKED');
    await h.settle();
    expect(h.sent).toHaveLength(2);
    h.advance(ALERT_NOTIFY_POLICY.reraiseCooldownMs - 1000);
    await h.settle();
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]).toContain('**운영 경보** `READINESS_LOCKED`');
  });

  it('tells a raise and clear that happened between two flushes as a transient', async () => {
    const h = harness();
    h.policy.observe(h.sample('operations.journal.writable', 0));
    h.advance(400);
    h.policy.observe(h.sample('operations.journal.writable', 1));
    await h.settle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('**일시 경보** `JOURNAL_NOT_WRITABLE`');
    // The reason is why it was raised, not why it cleared.
    expect(h.sent[0]).toContain('발생 후 1초 미만 만에 해제됐다. 근거: writable=0');
  });

  it('says a manual-clear alert will not clear by itself', async () => {
    const h = harness();
    h.policy.observe(h.sample('media.retirement.unresolved', 1));
    await h.settle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('`MEDIA_RETIREMENT_UNRESOLVED`');
    expect(h.sent[0]).toContain('자동으로 해제되지 않는다');
  });

  it('sends one notice at a time, in rule order', async () => {
    const h = harness();
    h.policy.observe(h.sample('operations.journal.writable', 0));
    h.policy.observe(h.sample('media.api.429', 1));
    h.notifier.flush();
    await h.notifier.idle();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toContain('MEDIA_API_RATE_LIMITED');
    h.notifier.flush();
    await h.notifier.idle();
    expect(h.sent[1]).toContain('JOURNAL_NOT_WRITABLE');
  });
});

describe('failed delivery', () => {
  it('reports a code, retries after retryMs and only then moves on', async () => {
    let fail = true;
    const sent: string[] = [];
    const h = harness(async (text) => {
      if (fail) throw new AlertDeliveryError('HTTP_502');
      sent.push(text);
    });
    h.policy.observeReadiness('LOCKED');
    await h.settle();
    expect(h.failures).toEqual([['READINESS_LOCKED', 'HTTP_502']]);
    h.advance(ALERT_NOTIFY_POLICY.retryMs - 1);
    await h.settle();
    expect(h.failures).toHaveLength(1);
    fail = false;
    h.advance(1);
    await h.settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('**운영 경보** `READINESS_LOCKED`');
  });

  it('never lets a throwing sender or failure hook escape flush', async () => {
    const notifier = createAlertNotifier({
      now: () => 0,
      service: 's',
      send: () => {
        throw new Error(`boom ${HOOK}`);
      },
      onFailure: () => {
        throw new Error('hook');
      },
    });
    notifier.observe({
      event: 'alert.raised',
      level: 'error',
      atMs: 0,
      fields: { alert: 'READINESS_LOCKED', severity: 'critical', reason: 'r', count: 1 },
    });
    expect(() => notifier.flush()).not.toThrow();
    await expect(notifier.idle()).resolves.toBeUndefined();
  });

  it('announces a clear that arrived while the raise was in flight as CLEARED', async () => {
    let release!: () => void;
    const sent: string[] = [];
    const h = harness(
      (text) =>
        new Promise<void>((done) => {
          sent.push(text);
          release = done;
        }),
    );
    h.policy.observeReadiness('LOCKED');
    h.notifier.flush();
    h.policy.observeReadiness('READY');
    release();
    await h.notifier.idle();
    h.advance(ALERT_NOTIFY_POLICY.clearHoldMs);
    h.notifier.flush();
    release();
    await h.notifier.idle();
    expect(sent.map((t) => t.split('\n')[0])).toEqual([
      ':rotating_light: **운영 경보** `READINESS_LOCKED` · kkakkung-test',
      ':white_check_mark: **경보 해제** `READINESS_LOCKED` · kkakkung-test',
    ]);
    await h.settle();
    expect(sent).toHaveLength(2);
  });
});

describe('webhook sender', () => {
  const fakeFetch =
    (respond: (init: RequestInit) => Promise<Response>) =>
    async (_url: string | URL | Request, init?: RequestInit) =>
      respond(init ?? {});

  it('posts the incoming-webhook JSON with the configured channel', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const send = createWebhookSender(
      { url: HOOK, channel: 'kkakkung-ops' },
      {
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
          return new Response(null, { status: 200 });
        }) as typeof fetch,
      },
    );
    await send('hello');
    expect(calls).toEqual([
      { url: HOOK, body: { text: 'hello', username: 'kkakkung-ops', channel: 'kkakkung-ops' } },
    ]);
  });

  it('turns every failure into a fixed code without the URL', async () => {
    const cases: [typeof fetch, string][] = [
      [fakeFetch(async () => new Response('no', { status: 404 })) as typeof fetch, 'HTTP_404'],
      [
        fakeFetch(async () => {
          throw new TypeError(`fetch failed ${HOOK}`);
        }) as typeof fetch,
        'NETWORK',
      ],
      [
        fakeFetch(
          (init) =>
            new Promise((_, reject) =>
              init.signal?.addEventListener('abort', () => reject(new Error(`aborted ${HOOK}`))),
            ),
        ) as typeof fetch,
        'TIMEOUT',
      ],
    ];
    for (const [doFetch, code] of cases) {
      const send = createWebhookSender(
        { url: HOOK, channel: null },
        { fetch: doFetch, timeoutMs: 5 },
      );
      const error = await send('x').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AlertDeliveryError);
      expect((error as AlertDeliveryError).code).toBe(code);
      expect(String(error)).not.toContain('hooks');
      expect(JSON.stringify(error)).not.toContain('hooks');
      expect((error as Error).stack ?? '').not.toContain('abc123secretkey');
    }
  });

  it('keeps messages free of URLs', () => {
    for (const id of NOTIFIED_ALERTS)
      for (const kind of ['RAISED', 'CLEARED', 'TRANSIENT'] as const) {
        const text = formatAlertNotice(kind, id, {
          service: 'kkakkung',
          reason: 'r',
          count: 2,
          lastedMs: 90_000,
        });
        expect(text).not.toMatch(/https?:\/\//);
        expect(text).toContain(`\`${id}\``);
      }
  });
});

describe('configuration and log event', () => {
  const base = { NODE_ENV: 'test', LOG_LEVEL: 'silent' } as const;

  it('stays log-only when no webhook is configured', () => {
    expect(parseConfig(base).alertWebhook).toBeNull();
    expect(parseConfig({ ...base, ALERT_WEBHOOK_URL: '' }).alertWebhook).toBeNull();
  });

  it('accepts an https webhook and an optional channel', () => {
    expect(parseConfig({ ...base, ALERT_WEBHOOK_URL: HOOK }).alertWebhook).toEqual({
      url: HOOK,
      channel: null,
    });
    expect(
      parseConfig({ ...base, ALERT_WEBHOOK_URL: HOOK, ALERT_WEBHOOK_CHANNEL: 'kkakkung-ops' })
        .alertWebhook,
    ).toEqual({ url: HOOK, channel: 'kkakkung-ops' });
  });

  it('refuses unsafe values without echoing them', () => {
    const bad: Record<string, string>[] = [
      { ALERT_WEBHOOK_URL: 'http://mattermost.example/hooks/abc123secretkey' },
      { ALERT_WEBHOOK_URL: 'https://user:abc123secretkey@mattermost.example/hooks/x' },
      { ALERT_WEBHOOK_URL: 'not a url abc123secretkey' },
      { ALERT_WEBHOOK_CHANNEL: 'kkakkung-ops' },
      { ALERT_WEBHOOK_URL: HOOK, ALERT_WEBHOOK_CHANNEL: 'Ops Channel' },
    ];
    for (const extra of bad) {
      const error = (() => {
        try {
          parseConfig({ ...base, ...extra });
          return null;
        } catch (e) {
          return e as Error;
        }
      })();
      expect(error, JSON.stringify(Object.keys(extra))).toBeInstanceOf(Error);
      expect(error!.message).not.toContain('abc123secretkey');
      expect(error!.message).toMatch(/ALERT_WEBHOOK/);
    }
  });

  it('registers alert.notify.failed with the alert id and code only', () => {
    expect(EVENT_NAMES).toContain('alert.notify.failed');
    expect(
      validateEvent({
        event: 'alert.notify.failed',
        level: 'warn',
        atMs: 1,
        fields: { alert: 'READINESS_LOCKED', code: 'TIMEOUT' },
      }).ok,
    ).toBe(true);
  });
});
