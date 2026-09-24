// Owned by F (F-07 / DP-05). Local alert state derived from registered metrics.
//
// This module never pages anyone itself: it only derives local alert state that operations code
// (E's readiness lock, F's deploy runner) can read, and emits a structured event that lands in
// the log. The one external channel, a Mattermost/Slack webhook, is a separate module
// (`AlertNotifier.ts`'s `createWebhookSender`) that watches these transitions from outside.
//
// Rules the contract test pins down:
// - `media.retirement.unresolved` raises MEDIA_RETIREMENT_UNRESOLVED and it stays active until
//   an operator acknowledges it with evidence. Time passing never clears it.
// - Budget / 429 / journal alerts clear when a later sample shows the condition is gone.
// - `isLocked()` is true while any alert that locks operations is active. Deploy and resume
//   must consult it; they must not treat HTTP ready 200 as "no alerts".

import { MEDIA_API_CEILINGS } from '../operations/ApiBudget.js';
import type { MetricSample } from './MetricRegistry.js';
import type { StructuredEvent } from './StructuredEvents.js';

export type AlertId =
  | 'MEDIA_API_BUDGET_NEAR_LIMIT'
  | 'MEDIA_API_RATE_LIMITED'
  | 'MEDIA_POLICY_UNCERTAIN'
  | 'MEDIA_RETIREMENT_UNRESOLVED'
  | 'JOURNAL_NOT_WRITABLE'
  | 'READINESS_LOCKED'
  | 'TICK_OVERLOAD'
  | 'OBSERVABILITY_DROPPED';

export type AlertSeverity = 'warning' | 'critical';

export type AlertRule = Readonly<{
  id: AlertId;
  severity: AlertSeverity;
  /** When true the alert only clears through `acknowledgeResolved` with evidence. */
  requiresManualClear: boolean;
  /** When true `isLocked()` reports the server as operationally locked while active. */
  locksOperations: boolean;
  description: string;
}>;

/** Thresholds referenced by v0.0.8 ch. 22/23: 900 total API calls per 60 s, 1 s permission uncertainty. */
export const ALERT_THRESHOLDS = Object.freeze({
  /** 90 % of the 900 calls / 60 s emergency ceiling. */
  mediaApiTotal60sNearLimit: 810,
  /** Any 429 in a window is a budget breach signal. */
  mediaApi429: 1,
  /** A permission response slower than this is treated as an uncertain policy outcome. */
  mediaPolicyResponseLatencyMs: 1000,
  /** A retirement not resolved within this window must be visible; the alert itself is raised on the first sample. */
  mediaRetirementUnresolvedMs: 10_000,
});

export const ALERT_RULES: Readonly<Record<AlertId, AlertRule>> = Object.freeze({
  MEDIA_API_BUDGET_NEAR_LIMIT: {
    id: 'MEDIA_API_BUDGET_NEAR_LIMIT',
    severity: 'warning',
    requiresManualClear: false,
    locksOperations: false,
    description: 'media.api.total60s reached 90 % of the configured calls / 60 s ceiling',
  },
  MEDIA_API_RATE_LIMITED: {
    id: 'MEDIA_API_RATE_LIMITED',
    severity: 'critical',
    requiresManualClear: false,
    locksOperations: false,
    description: 'the media provider answered 429 in the current window',
  },
  MEDIA_POLICY_UNCERTAIN: {
    id: 'MEDIA_POLICY_UNCERTAIN',
    severity: 'warning',
    requiresManualClear: false,
    locksOperations: false,
    description: 'a permission response took longer than 1 s',
  },
  MEDIA_RETIREMENT_UNRESOLVED: {
    id: 'MEDIA_RETIREMENT_UNRESOLVED',
    severity: 'critical',
    requiresManualClear: true,
    locksOperations: true,
    description:
      'a media retirement ended UNRESOLVED; reservation stays held until an operator confirms cleanup',
  },
  JOURNAL_NOT_WRITABLE: {
    id: 'JOURNAL_NOT_WRITABLE',
    severity: 'critical',
    requiresManualClear: false,
    locksOperations: true,
    description: 'the operations journal reported it cannot write',
  },
  READINESS_LOCKED: {
    id: 'READINESS_LOCKED',
    severity: 'critical',
    requiresManualClear: false,
    locksOperations: true,
    description: 'readiness is LOCKED; new admissions and deploy progression are blocked',
  },
  TICK_OVERLOAD: {
    id: 'TICK_OVERLOAD',
    severity: 'critical',
    requiresManualClear: true,
    locksOperations: false,
    description: 'a room aborted its match because the tick loop fell behind',
  },
  OBSERVABILITY_DROPPED: {
    id: 'OBSERVABILITY_DROPPED',
    severity: 'warning',
    requiresManualClear: true,
    locksOperations: false,
    description: 'metric samples were dropped; the observation for this window is incomplete',
  },
});

export type AlertState = Readonly<{
  id: AlertId;
  severity: AlertSeverity;
  active: boolean;
  raisedAtMs: number;
  updatedAtMs: number;
  /** Times the condition was observed while active. */
  occurrences: number;
  lastValue: number;
  matchRef?: string;
  requestId?: string;
  reason: string;
}>;

export type ReadinessState = 'READY' | 'RECOVERING' | 'LOCKED';

export type AlertPolicyOptions = Readonly<{
  now: () => number;
  /** Same total ceiling used by ApiBudget. Omission keeps the 900-call default. */
  mediaApiTotalLimit?: number;
  /** Receives `alert.raised` / `alert.cleared` events. Usually `createStructuredEventLogger(...).emit`. */
  onEvent?: (event: StructuredEvent) => void;
}>;

type MutableAlert = {
  -readonly [K in keyof AlertState]: AlertState[K];
};

export class AlertPolicy {
  private readonly now: () => number;
  private readonly onEvent: AlertPolicyOptions['onEvent'];
  private readonly mediaApiTotalLimit: number;
  private readonly mediaApiNearLimit: number;
  private readonly alerts = new Map<AlertId, MutableAlert>();

  constructor(options: AlertPolicyOptions) {
    this.now = options.now;
    this.onEvent = options.onEvent;
    this.mediaApiTotalLimit = options.mediaApiTotalLimit ?? 900;
    if (
      !Number.isSafeInteger(this.mediaApiTotalLimit) ||
      this.mediaApiTotalLimit < 1 ||
      this.mediaApiTotalLimit > MEDIA_API_CEILINGS.totalPer60s
    )
      throw new Error('INVALID_ALERT_API_BUDGET');
    this.mediaApiNearLimit = Math.ceil((this.mediaApiTotalLimit * 9) / 10);
  }

  /** Evaluates one registered metric sample. Never throws. */
  observe(sample: MetricSample): void {
    try {
      switch (sample.name) {
        case 'media.api.total60s':
          this.set(
            'MEDIA_API_BUDGET_NEAR_LIMIT',
            sample.value >= this.mediaApiNearLimit,
            sample,
            `total60s=${sample.value}; warning=${this.mediaApiNearLimit}; limit=${this.mediaApiTotalLimit}`,
          );
          return;
        case 'media.api.429':
          this.set(
            'MEDIA_API_RATE_LIMITED',
            sample.value >= ALERT_THRESHOLDS.mediaApi429,
            sample,
            `429=${sample.value}`,
          );
          return;
        case 'media.policy.responseLatency':
          if (sample.value > ALERT_THRESHOLDS.mediaPolicyResponseLatencyMs)
            this.set('MEDIA_POLICY_UNCERTAIN', true, sample, `responseLatency=${sample.value}ms`);
          else this.set('MEDIA_POLICY_UNCERTAIN', false, sample, 'response within 1 s');
          return;
        case 'media.retirement.unresolved':
          if (sample.value >= 1)
            this.set('MEDIA_RETIREMENT_UNRESOLVED', true, sample, 'retirement UNRESOLVED');
          return;
        case 'operations.journal.writable':
          this.set('JOURNAL_NOT_WRITABLE', sample.value === 0, sample, `writable=${sample.value}`);
          return;
        case 'tick.overload':
          if (sample.value >= 1) this.set('TICK_OVERLOAD', true, sample, 'SERVER_TICK_OVERLOAD');
          return;
        case 'observability.dropped':
          if (sample.value >= 1)
            this.set('OBSERVABILITY_DROPPED', true, sample, `dropped=${sample.value}`);
          return;
        default:
          return;
      }
    } catch {
      // Alert evaluation must not disturb the producer.
    }
  }

  /** Readiness is not a metric; E's coordinator reports it directly. */
  observeReadiness(state: ReadinessState): void {
    const atMs = this.now();
    const pseudo: MetricSample = {
      name: 'operations.journal.writable',
      value: 1,
      unit: 'count',
      atMs,
    };
    this.set('READINESS_LOCKED', state === 'LOCKED', pseudo, `readiness=${state}`);
  }

  /**
   * Operator confirmation for alerts that require manual clearing. `evidence` is a short
   * reference (journal record id, operation id), never a secret. Returns false when there is
   * no active alert with that id.
   */
  acknowledgeResolved(id: AlertId, evidence: string): boolean {
    const alert = this.alerts.get(id);
    if (!alert || !alert.active) return false;
    if (!evidence || evidence.trim().length === 0) return false;
    this.clear(alert, `acknowledged: ${evidence.slice(0, 128)}`);
    return true;
  }

  active(): AlertState[] {
    return [...this.alerts.values()].filter((a) => a.active).map((a) => ({ ...a }));
  }

  /** True while any alert flagged `locksOperations` is active. */
  isLocked(): boolean {
    return this.active().some((a) => ALERT_RULES[a.id].locksOperations);
  }

  snapshot(): Readonly<{ atMs: number; locked: boolean; active: AlertState[] }> {
    return { atMs: this.now(), locked: this.isLocked(), active: this.active() };
  }

  private set(id: AlertId, condition: boolean, sample: MetricSample, reason: string): void {
    const rule = ALERT_RULES[id];
    const existing = this.alerts.get(id);
    const atMs = this.now();
    if (condition) {
      if (existing && existing.active) {
        existing.occurrences += 1;
        existing.updatedAtMs = atMs;
        existing.lastValue = sample.value;
        existing.reason = reason;
        return;
      }
      const alert: MutableAlert = {
        id,
        severity: rule.severity,
        active: true,
        raisedAtMs: atMs,
        updatedAtMs: atMs,
        occurrences: 1,
        lastValue: sample.value,
        reason,
        ...(sample.matchRef !== undefined ? { matchRef: sample.matchRef } : {}),
        ...(sample.requestId !== undefined ? { requestId: sample.requestId } : {}),
      };
      this.alerts.set(id, alert);
      this.emit('alert.raised', alert);
      return;
    }
    if (existing && existing.active && !rule.requiresManualClear) this.clear(existing, reason);
  }

  private clear(alert: MutableAlert, reason: string): void {
    alert.active = false;
    alert.updatedAtMs = this.now();
    alert.reason = reason;
    this.emit('alert.cleared', alert);
  }

  private emit(name: 'alert.raised' | 'alert.cleared', alert: MutableAlert): void {
    if (!this.onEvent) return;
    try {
      this.onEvent({
        event: name,
        level:
          name === 'alert.raised' ? (alert.severity === 'critical' ? 'error' : 'warn') : 'info',
        atMs: alert.updatedAtMs,
        fields: {
          alert: alert.id,
          severity: alert.severity,
          reason: alert.reason,
          value: alert.lastValue,
          count: alert.occurrences,
          ...(alert.matchRef !== undefined ? { matchRef: alert.matchRef } : {}),
          ...(alert.requestId !== undefined ? { requestId: alert.requestId } : {}),
        },
      });
    } catch {
      // The event sink is best effort.
    }
  }
}

export function createAlertPolicy(options: AlertPolicyOptions): AlertPolicy {
  return new AlertPolicy(options);
}
