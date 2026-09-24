import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { TrackRegistry } from './TrackRegistry.js';
import { WebhookAuthenticationError } from './webhook-answer.js';

export { WebhookAuthenticationError, answerWebhook } from './webhook-answer.js';

export type WebhookVerifier = Pick<WebhookReceiver, 'receive'>;
const events = new Set([
  'track_published',
  'track_unpublished',
  'participant_joined',
  'participant_left',
  'participant_connection_aborted',
  'room_finished',
]);

export class LiveKitWebhook {
  private readonly seen = new Map<string, number>();
  private readonly pending = new Map<string, Promise<{ status: 'accepted' | 'ignored' }>>();
  constructor(
    private readonly options: {
      apiKey: string;
      apiSecret: string;
      registry: Pick<TrackRegistry, 'markEvent' | 'reconcileDue'>;
      now: () => number;
      verifier?: WebhookVerifier;
      maxEventIds?: number;
      /** Diagnostics: event type and what happened to it. Never identities or bodies. */
      onEvent?: (name: string, outcome: 'accepted' | 'ignored' | 'unauthenticated') => void;
    },
  ) {
    this.verifier = options.verifier ?? new WebhookReceiver(options.apiKey, options.apiSecret);
  }
  private readonly verifier: WebhookVerifier;

  async handle(
    rawBody: string,
    authorization: string,
  ): Promise<{ status: 'accepted' | 'ignored' }> {
    const note = (name: string, outcome: 'accepted' | 'ignored' | 'unauthenticated') => {
      try {
        this.options.onEvent?.(name, outcome);
      } catch {
        /* Diagnostics never change webhook handling. */
      }
    };
    if (!authorization) {
      note('unknown', 'unauthenticated');
      throw new WebhookAuthenticationError();
    }
    let event: WebhookEvent;
    try {
      event = await this.verifier.receive(rawBody, authorization, false);
    } catch {
      note('unknown', 'unauthenticated');
      throw new WebhookAuthenticationError();
    }
    const name = typeof event.event === 'string' ? event.event : 'unknown';
    const ignored = () => {
      note(name, 'ignored');
      return { status: 'ignored' as const };
    };
    if (!event.id || !events.has(event.event) || !event.room?.name) return ignored();
    if (this.seen.has(event.id) || this.pending.has(event.id)) return ignored();
    const identity = event.participant?.identity;
    if (event.event !== 'room_finished' && !identity) return ignored();
    const matched = this.options.registry.markEvent({
      roomName: event.room.name,
      ...(identity ? { identity } : {}),
    });
    if (!matched) return ignored();
    const result = this.accept(event.id).then((outcome) => {
      note(name, outcome.status);
      return outcome;
    });
    this.pending.set(event.id, result);
    return result;
  }

  private async accept(eventId: string): Promise<{ status: 'accepted' | 'ignored' }> {
    try {
      await this.options.registry.reconcileDue();
      this.seen.set(eventId, this.options.now());
      const maximum = Math.max(1, this.options.maxEventIds ?? 2048);
      while (this.seen.size > maximum) this.seen.delete(this.seen.keys().next().value!);
      return { status: 'accepted' };
    } finally {
      this.pending.delete(eventId);
    }
  }
}
