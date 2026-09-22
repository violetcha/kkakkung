// S15P21C204-253: the public audience (guest admission) with publisher-permissions media. The real
// A/B/E/F server runs in a child process and six real C runtimes join as guests through a host
// invitation. Devices and Cloud transport stay synthetic, so this proves the product wiring of the
// public combination, not Cloud reception, abuse resistance or a public deployment.
import { randomUUID } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  ROOM_INVITATION_ROUTE,
  roomInvitationResponseSchema,
  sessionResponseSchema,
  type MediaGrant,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { bindProductRoom } from '../../../apps/web/src/app/product-runtime';
import { productRoomPort } from '../../../apps/web/src/features/room/product-session';
import {
  clearConsentedDevice,
  useConsentedDevice,
} from '../../../apps/web/src/features/room/consent-fixture';
import { createSyntheticInteractionFactory } from '../../../apps/web/src/app/product-integration-fixture';
import { startProductServerProcess } from './product-server-process.js';

// The real web runtime refuses to touch devices before the privacy notice is accepted
// (S15P21C204-292). These clients drive that runtime, so they start from a consented device.
beforeAll(() => useConsentedDevice());
afterAll(() => clearConsentedDevice());

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

it('lets six guests enter through a host invitation and receive publisher-permissions media', async () => {
  const opsToken = randomUUID();
  const server = await startProductServerProcess(opsToken, {
    operatingMode: 'continuous',
    subscriptionMode: 'publisher-permissions',
    audience: 'public',
  });
  closers.push(() => server.close());
  const endpoint = server.endpoint;
  const operator = { authorization: `Bearer ${opsToken}`, 'content-type': 'application/json' };
  await expect
    .poll(async () => (await server.inspect()).readiness, { timeout: 5000 })
    .toMatchObject({ state: 'READY', reasonCodes: [] });
  const resume = randomUUID();
  await fetch(`${endpoint}/api/operations/commands`, {
    method: 'POST',
    headers: operator,
    body: JSON.stringify({ requestId: resume, action: 'resume' }),
  });
  await expect
    .poll(
      async () => {
        const response = await fetch(`${endpoint}/api/operations/commands/${resume}`, {
          headers: operator,
        });
        return ((await response.json()) as { status: string }).status;
      },
      { timeout: 5000 },
    )
    .toBe('succeeded');

  const access = await fetch(`${endpoint}/api/sessions/access`, {
    headers: { 'x-sso-user': 'forged' },
  });
  expect(await access.json()).toEqual({ method: 'guest' });
  const requestSession = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    fetch(`${endpoint}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', ...headers },
      body: JSON.stringify(body),
    });

  const sdk = new Client(endpoint);
  const players: { runtime: ReturnType<typeof bindProductRoom>; grants: MediaGrant[] }[] = [];
  const join = async (session: SessionResponse) => {
    const room = await sdk.joinOrCreate<PublicMatchState>(PRODUCT_ROOM_NAME, {
      token: session.sessionToken,
      roomCode: session.roomCode,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    });
    const grants: MediaGrant[] = [];
    const runtime = bindProductRoom(productRoomPort(room), session, {
      now: () => performance.now(),
      uuid: randomUUID,
      changed: () => {},
      fetcher: (input, init) => {
        const url = String(input);
        return fetch(url.startsWith('/') ? endpoint + url : input, init);
      },
      interactionFactory: createSyntheticInteractionFactory({
        publish: async (grant) => {
          grants.push(grant);
          await server.publish(grant);
          return `FACE_${grant.mediaIdentity}`;
        },
      }),
    });
    room.onMessage('*', () => {});
    players.push({ runtime, grants });
    closers.push(() => runtime.leave());
  };

  // A guest creates a room with only a nickname; forged SSO headers grant nothing.
  const created = await requestSession(
    { nickname: '방장', createRoom: true },
    { 'x-sso-user': 'forged' },
  );
  expect(created.status).toBe(201);
  const host = sessionResponseSchema.parse(await created.json());
  await join(host);
  const timer = setInterval(() => players.forEach((player) => player.runtime.poll()), 20);
  closers.push(async () => clearInterval(timer));

  // The room code alone is not an invitation for guests.
  const codeOnly = await requestSession(
    { nickname: '코드만', createRoom: false, roomCode: host.roomCode },
    { 'x-sso-user': 'forged' },
  );
  expect(codeOnly.status).toBe(403);

  // Only the connected host may issue the room invitation, so wait until the join is registered.
  const issued: { invitation?: { inviteToken: string; roomCode: string } } = {};
  await expect
    .poll(async () => {
      const response = await fetch(endpoint + ROOM_INVITATION_ROUTE, {
        method: 'POST',
        headers: { authorization: `Bearer ${host.sessionToken}` },
      });
      if (response.status === 201)
        issued.invitation = roomInvitationResponseSchema.parse(await response.json());
      return issued.invitation !== undefined;
    })
    .toBe(true);
  for (let seat = 2; seat <= 6; seat++) {
    const response = await requestSession({
      nickname: `친구${seat}`,
      inviteToken: issued.invitation!.inviteToken,
      createRoom: false,
      roomCode: issued.invitation!.roomCode,
    });
    expect(response.status).toBe(201);
    await join(sessionResponseSchema.parse(await response.json()));
  }

  const summary = () =>
    players.map((player) => {
      const snapshot = player.runtime.getSnapshot();
      return { phase: snapshot.round?.phase, error: snapshot.error };
    });
  const waitAll = (phase: string, timeout: number) =>
    expect
      .poll(summary, { timeout, interval: 100 })
      .toEqual(players.map(() => ({ phase, error: null })));

  await waitAll('DEVICE_CHECK', 30_000);
  for (const player of players) {
    await player.runtime.startDevices(false);
    player.runtime.ready(true);
  }
  // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작한다. 준비 보고가 아직
  // 다 적용되기 전이면 거절되므로 단계가 바뀔 때까지 다시 누른다.
  await expect
    .poll(
      () => {
        // 방을 만든 사람이 방장이고, 그가 첫 번째로 들어왔다.
        const first = players[0]!;
        first.runtime.send({ type: 'ROOM_START', payload: {} });
        return first.runtime.getSnapshot().round?.phase;
      },
      { timeout: 30_000, interval: 100 },
    )
    .toBe('TEAM_PRACTICE');
  await waitAll('TEAM_PRACTICE', 30_000);
  await expect
    .poll(() => players.every((player) => player.grants.length >= 1), { timeout: 30_000 })
    .toBe(true);
  for (const player of players)
    player.runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } });
  await waitAll('PLAYING', 90_000);

  // Every guest received a fresh publisher-permissions grant for the match.
  expect(players.every((player) => player.grants.length >= 2)).toBe(true);
  expect(
    players.every((player) =>
      player.grants.every((grant) => grant.subscriptionMode === 'publisher-permissions'),
    ),
  ).toBe(true);
  const final = await server.inspect();
  expect(final.rooms).toHaveLength(1);
  expect(final.rooms[0]!.phase).toBe('PLAYING');
  expect(final.readiness).toMatchObject({ state: 'READY', reasonCodes: [] });
}, 300_000);
