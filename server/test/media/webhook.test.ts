import { createHash } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { describe, expect, it, vi } from 'vitest';
import { LiveKitWebhook } from '../../src/media/LiveKitWebhook.js';
import { TrackRegistry } from '../../src/media/TrackRegistry.js';

// Synthetic, local-only signing material; no Cloud request or real credential is used.
const apiKey = 'local-webhook-test';
const apiSecret = 'local-only-webhook-signature-test-secret';
async function signed(event = 'track_published', id = 'e1', roomName = 'room') {
  const rawBody = JSON.stringify({
    event,
    id,
    createdAt: '1',
    room: { name: roomName },
    participant: { identity: 'identity' },
  });
  const token = new AccessToken(apiKey, apiSecret, { ttl: 60 });
  token.sha256 = createHash('sha256').update(rawBody).digest('base64');
  return { rawBody, authorization: await token.toJwt() };
}
function setup() {
  let now = 0;
  const query = vi.fn(async () => null);
  const registry = new TrackRegistry({
    now: () => now,
    getParticipant: query,
    onChanged: vi.fn(),
    onUnauthorized: vi.fn(),
  });
  registry.register({
    matchId: 'm',
    mediaInstanceId: 'i',
    mediaRoomName: 'room',
    playerId: 'p',
    mediaIdentity: 'identity',
    publisherGeneration: 1,
  });
  const handler = new LiveKitWebhook({
    apiKey,
    apiSecret,
    registry,
    now: () => now,
    maxEventIds: 2,
  });
  return {
    handler,
    query,
    registry,
    time: (value: number) => {
      now = value;
    },
  };
}

describe('SDK authenticated raw webhook handling', () => {
  it('rejects missing authorization and body tampering without changing registry', async () => {
    const s = setup();
    const event = await signed();
    await expect(s.handler.handle(event.rawBody, '')).rejects.toMatchObject({
      statusCode: 401,
      message: 'INVALID_WEBHOOK',
    });
    await expect(s.handler.handle(`${event.rawBody} `, event.authorization)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(s.query).not.toHaveBeenCalled();
  });
  it('deduplicates authenticated events and treats createdAt as insufficient for state', async () => {
    const s = setup();
    const event = await signed();
    expect(await s.handler.handle(event.rawBody, event.authorization)).toEqual({
      status: 'accepted',
    });
    expect(await s.handler.handle(event.rawBody, event.authorization)).toEqual({
      status: 'ignored',
    });
    expect(s.query).toHaveBeenCalledTimes(1);
    s.time(5000);
    const older = await signed('track_unpublished', 'old');
    expect(await s.handler.handle(older.rawBody, older.authorization)).toEqual({
      status: 'accepted',
    });
    expect(s.query).toHaveBeenCalledTimes(2);
  });
  it.each([
    'participant_joined',
    'participant_left',
    'participant_connection_aborted',
    'room_finished',
  ])('routes actual server %s event names to current registry lookup', async (name) => {
    const s = setup();
    const event = await signed(name);
    expect(await s.handler.handle(event.rawBody, event.authorization)).toEqual({
      status: 'accepted',
    });
    expect(s.query).toHaveBeenCalledOnce();
  });
  it('ignores events outside the registered room or browser-only event names', async () => {
    const s = setup();
    const outside = await signed('track_published', 'outside', 'foreign-room');
    const browser = await signed('TrackSubscribed', 'browser');
    expect(await s.handler.handle(outside.rawBody, outside.authorization)).toEqual({
      status: 'ignored',
    });
    expect(await s.handler.handle(browser.rawBody, browser.authorization)).toEqual({
      status: 'ignored',
    });
    expect(s.query).not.toHaveBeenCalled();
  });
});
