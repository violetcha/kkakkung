// S15P21C204-288. Delivers critical AlertPolicy transitions to an external webhook (Mattermost).
//
// AlertPolicy stays the only judge: this module never decides that something is wrong, it only
// tells people what the policy already raised or cleared. It is fed the policy's own
// `alert.raised` / `alert.cleared` events and is flushed once per second by the metrics loop.
//
// What operators get, per alert id:
// - RAISED as soon as the policy raises it, unless the same alert was delivered less than
//   `reraiseCooldownMs` ago. A deferred raise is still delivered once the cooldown ends.
// - CLEARED only after the alert has stayed clear for `clearHoldMs`, so a flapping condition
//   produces one raise, not a message per flap.
// - TRANSIENT when an alert raised and cleared before its raise could be delivered, so a
//   short 429 or journal failure is never silently lost.
// - A failed delivery is retried after `retryMs`; the state only moves on success.
// Warnings stay log-only. Manual-clear alerts have no clear path in the server, so they get a
// RAISED and nothing else until the process restarts.
//
// Messages carry the alert id, the policy's reason and the service namespace. No webhook URL,
// token, identity or room data is ever put into a message, an error or a log line.
import { ALERT_RULES, type AlertId } from './AlertPolicy.js';
import type { StructuredEvent } from './StructuredEvents.js';

export const ALERT_NOTIFY_POLICY = Object.freeze({
  clearHoldMs: 60_000,
  reraiseCooldownMs: 300_000,
  retryMs: 60_000,
  timeoutMs: 5_000,
});

export type AlertNotifyPolicy = Readonly<{
  clearHoldMs: number;
  reraiseCooldownMs: number;
  retryMs: number;
}>;

/** Critical rules only; a rule that becomes critical later is included without a change here. */
export const NOTIFIED_ALERTS: readonly AlertId[] = Object.freeze(
  (Object.keys(ALERT_RULES) as AlertId[]).filter((id) => ALERT_RULES[id].severity === 'critical'),
);

const SUMMARY: Partial<Record<AlertId, string>> = {
  READINESS_LOCKED: '준비 상태가 LOCKED다. 새 입장과 배포 진행이 막혀 있다',
  MEDIA_API_RATE_LIMITED: 'LiveKit API가 429로 응답했다',
  JOURNAL_NOT_WRITABLE: '운영 저널에 쓸 수 없다. 발급과 좌석 반환이 잠긴다',
  MEDIA_RETIREMENT_UNRESOLVED:
    '미디어 회수가 확인되지 않았다. 좌석을 잡은 채 운영자 확인을 기다린다',
  TICK_OVERLOAD: '틱이 밀려 경기가 중단됐다',
};

export type AlertNoticeKind = 'RAISED' | 'CLEARED' | 'TRANSIENT';

/** Thrown by a sender. `code` is the only thing that reaches a log line. */
export class AlertDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AlertDeliveryError';
  }
}

export type AlertSend = (text: string) => Promise<void>;

export type AlertNotifierOptions = Readonly<{
  /** Same monotonic clock as AlertPolicy, so event times and `now()` compare directly. */
  now: () => number;
  send: AlertSend;
  /** Deployment namespace, shown so a QA namespace is never mistaken for production. */
  service: string;
  /** One call per failed delivery attempt, with a fixed code only. */
  onFailure?: (alert: AlertId, code: string) => void;
  policy?: Partial<AlertNotifyPolicy>;
}>;

type Track = {
  /** Mirrors the policy: raised and not yet cleared. */
  active: boolean;
  /** Operators were told the alert is active and have not been told it cleared. */
  announced: boolean;
  /** An episode that raised and cleared before anyone was told. */
  transient: boolean;
  raisedAtMs: number;
  clearedAtMs: number | null;
  reason: string;
  count: number;
  lastSentAtMs: number | null;
  retryAtMs: number;
};

const NOTIFIED = new Set<AlertId>(NOTIFIED_ALERTS);

function isNotified(value: unknown): value is AlertId {
  return typeof value === 'string' && NOTIFIED.has(value as AlertId);
}

function duration(ms: number): string {
  if (ms < 1000) return '1초 미만';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 ${seconds % 60}초`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

/** Pure message text for one notice. Exported for the contract test. */
export function formatAlertNotice(
  kind: AlertNoticeKind,
  id: AlertId,
  input: Readonly<{ service: string; reason: string; count: number; lastedMs: number }>,
): string {
  const summary = SUMMARY[id] ?? ALERT_RULES[id].description;
  if (kind === 'CLEARED')
    return [
      `:white_check_mark: **경보 해제** \`${id}\` · ${input.service}`,
      `- ${duration(input.lastedMs)} 지속, 관측 ${input.count}회`,
    ].join('\n');
  if (kind === 'TRANSIENT')
    return [
      `:warning: **일시 경보** \`${id}\` · ${input.service}`,
      `- ${summary}`,
      `- 발생 후 ${duration(input.lastedMs)} 만에 해제됐다. 근거: ${input.reason}`,
      '- 로그: `docker logs --since 1h kkakkung-game 2>&1 | grep alert.`',
    ].join('\n');
  const lines = [
    `:rotating_light: **운영 경보** \`${id}\` · ${input.service}`,
    `- ${summary}`,
    `- 근거: ${input.reason}`,
  ];
  if (ALERT_RULES[id].requiresManualClear)
    lines.push('- 자동으로 해제되지 않는다. 확인 후 조치하고, 재기동 전까지 이 경보는 켜져 있다');
  lines.push('- 대응: 운영 문서 6장 장애 대응');
  return lines.join('\n');
}

export class AlertNotifier {
  private readonly tracks = new Map<AlertId, Track>();
  private readonly policy: AlertNotifyPolicy;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly options: AlertNotifierOptions) {
    this.policy = { ...ALERT_NOTIFY_POLICY, ...options.policy };
  }

  /** Feed every event the policy emits; anything that is not a critical transition is ignored. */
  observe(event: StructuredEvent): void {
    if (event.event !== 'alert.raised' && event.event !== 'alert.cleared') return;
    const id = event.fields?.alert;
    if (!isNotified(id)) return;
    const reason = typeof event.fields?.reason === 'string' ? event.fields.reason : '';
    const count = typeof event.fields?.count === 'number' ? event.fields.count : 1;
    const track = this.track(id);
    if (event.event === 'alert.raised') {
      if (!track.active) track.raisedAtMs = event.atMs;
      track.active = true;
      track.transient = false;
      track.clearedAtMs = null;
      track.reason = reason;
      track.count = count;
      return;
    }
    if (!track.active) return;
    track.active = false;
    track.clearedAtMs = event.atMs;
    track.count = count;
    if (!track.announced) track.transient = true;
  }

  /**
   * Starts at most one delivery. Called once per second; never throws and never awaits, so the
   * metrics loop is not held by a slow webhook.
   */
  flush(): void {
    if (this.inFlight) return;
    const now = this.options.now();
    for (const id of NOTIFIED_ALERTS) {
      const track = this.tracks.get(id);
      if (!track || now < track.retryAtMs) continue;
      const kind = this.due(track, now);
      if (!kind) continue;
      this.deliver(id, track, kind, now);
      return;
    }
  }

  /** Resolves when the delivery in progress, if any, has settled. For tests and shutdown. */
  async idle(): Promise<void> {
    await this.inFlight;
  }

  private due(track: Track, now: number): AlertNoticeKind | null {
    const cooled =
      track.lastSentAtMs === null || now - track.lastSentAtMs >= this.policy.reraiseCooldownMs;
    if (track.active) return !track.announced && cooled ? 'RAISED' : null;
    if (track.announced)
      return track.clearedAtMs !== null && now - track.clearedAtMs >= this.policy.clearHoldMs
        ? 'CLEARED'
        : null;
    return track.transient && cooled ? 'TRANSIENT' : null;
  }

  private deliver(id: AlertId, track: Track, kind: AlertNoticeKind, now: number): void {
    const lastedMs = (track.clearedAtMs ?? now) - track.raisedAtMs;
    const text = formatAlertNotice(kind, id, {
      service: this.options.service,
      reason: track.reason,
      count: track.count,
      lastedMs,
    });
    let sending: Promise<void>;
    try {
      sending = this.options.send(text);
    } catch (error) {
      sending = Promise.reject(error);
    }
    const settled = sending
      .then(
        () => {
          track.lastSentAtMs = now;
          track.retryAtMs = 0;
          // Any delivered notice covers the episode: a clear that arrived while a RAISED was in
          // flight is announced later by CLEARED, not by TRANSIENT.
          track.transient = false;
          if (kind === 'RAISED') track.announced = true;
          else if (kind === 'CLEARED') track.announced = false;
        },
        (error: unknown) => {
          track.retryAtMs = this.options.now() + this.policy.retryMs;
          const code = error instanceof AlertDeliveryError ? error.code : 'SEND_FAILED';
          try {
            this.options.onFailure?.(id, code);
          } catch {
            // Reporting a failure must not break the notifier.
          }
        },
      )
      .then(() => {
        if (this.inFlight === settled) this.inFlight = null;
      });
    this.inFlight = settled;
  }

  private track(id: AlertId): Track {
    let track = this.tracks.get(id);
    if (!track) {
      track = {
        active: false,
        announced: false,
        transient: false,
        raisedAtMs: 0,
        clearedAtMs: null,
        reason: '',
        count: 0,
        lastSentAtMs: null,
        retryAtMs: 0,
      };
      this.tracks.set(id, track);
    }
    return track;
  }
}

export function createAlertNotifier(options: AlertNotifierOptions): AlertNotifier {
  return new AlertNotifier(options);
}

export type AlertWebhookTarget = Readonly<{ url: string; channel: string | null }>;

/**
 * Posts Mattermost/Slack incoming-webhook JSON. Every failure becomes an AlertDeliveryError
 * with a fixed code; the URL and the response body never leave this function.
 */
export function createWebhookSender(
  target: AlertWebhookTarget,
  options: Readonly<{ fetch?: typeof fetch; timeoutMs?: number; username?: string }> = {},
): AlertSend {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? ALERT_NOTIFY_POLICY.timeoutMs;
  const username = options.username ?? 'kkakkung-ops';
  return async (text) => {
    const body: Record<string, string> = { text, username };
    if (target.channel) body.channel = target.channel;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Drain so the socket is released; the body itself is never read into a message.
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new AlertDeliveryError(`HTTP_${response.status}`);
    } catch (error) {
      if (error instanceof AlertDeliveryError) throw error;
      throw new AlertDeliveryError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  };
}
