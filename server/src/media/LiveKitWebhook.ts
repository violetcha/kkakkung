import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';
import type { TrackRegistry } from './TrackRegistry.js';

export class WebhookAuthenticationError extends Error {
  readonly statusCode = 401;
  constructor() {
    super('INVALID_WEBHOOK');
  }
}
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
      registry: TrackRegistry;
      now: () => number;
      verifier?: WebhookVerifier;
      maxEventIds?: number;
    },
  ) {
    this.verifier = options.verifier ?? new WebhookReceiver(options.apiKey, options.apiSecret);
  }
  private readonly verifier: WebhookVerifier;

  async handle(
    rawBody: string,
    authorization: string,
  ): Promise<{ status: 'accepted' | 'ignored' }> {
    if (!authorization) throw new WebhookAuthenticationError();
    let event: WebhookEvent;
    try {
      event = await this.verifier.receive(rawBody, authorization, false);
    } catch {
      throw new WebhookAuthenticationError();
    }
    if (!event.id || !events.has(event.event) || !event.room?.name) return { status: 'ignored' };
    if (this.seen.has(event.id) || this.pending.has(event.id)) return { status: 'ignored' };
    const identity = event.participant?.identity;
    if (event.event !== 'room_finished' && !identity) return { status: 'ignored' };
    const matched = this.options.registry.markEvent({
      roomName: event.room.name,
      ...(identity ? { identity } : {}),
    });
    if (!matched) return { status: 'ignored' };
    const result = this.accept(event.id);
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
