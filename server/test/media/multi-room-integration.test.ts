// Opt-in local capacity measurement for S15P21C204-251. The real A/B/E/F server runs in a child
// process and six real C runtimes per room run here. Devices and Cloud transport stay synthetic,
// so this is NOT real WebRTC load, G2/G6 or Cloud acceptance. Real timers and the 250ms server
// overload gate stay live while every room loads and plays at the same time.
//   KKAKKUNG_TEST_ROOMS=10 pnpm exec vitest run server/test/media/multi-room-integration.test.ts
// KKAKKUNG_TEST_PLAYING_MS (default 20000) holds PLAYING; KKAKKUNG_TEST_REPORT writes the summary.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@colyseus/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sessionResponseSchema, type MediaGrant } from '@kkakkung/protocol/game-messages';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { bindProductRoom } from '../../../apps/web/src/app/product-runtime';
import { productRoomPort } from '../../../apps/web/src/features/room/product-session';
import {
  clearConsentedDevice,
  useConsentedDevice,
} from '../../../apps/web/src/features/room/consent-fixture';
import { createSyntheticInteractionFactory } from '../../../apps/web/src/app/product-integration-fixture';
import { INVITATION_ROUTES } from '../../src/session/invite-types.js';
import { startProductServerProcess } from './product-server-process.js';

// The real web runtime refuses to touch devices before the privacy notice is accepted
// (S15P21C204-292). These clients drive that runtime, so they start from a consented device.
beforeAll(() => useConsentedDevice());
afterAll(() => clearConsentedDevice());

const rooms = Number(process.env.KKAKKUNG_TEST_ROOMS ?? 0);
const playingMs = Number(process.env.KKAKKUNG_TEST_PLAYING_MS ?? 20_000);
const OVERLOAD_MS = 250;

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

describe.skipIf(!(Number.isInteger(rooms) && rooms >= 2 && rooms <= 10))(
  'multi-room product capacity with synthetic device/Cloud boundaries',
  () => {
    it('loads and plays every room at once without overload or media policy loss', async () => {
      const opsToken = randomUUID();
      const server = await startProductServerProcess(opsToken, {
        cpuProfile: process.env.KKAKKUNG_TEST_CPU_PROFILE === '1',
        operatingMode: 'continuous',
        rooms,
        subscriptionMode: 'publisher-permissions',
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

      const issueInvite = async () => {
        const response = await fetch(endpoint + INVITATION_ROUTES.issue, {
          method: 'POST',
          headers: operator,
          body: JSON.stringify({
            scope: { allowCreate: true, roomCodes: [] },
            expiresAt: Date.now() + 540_000,
          }),
        });
        expect(response.status).toBe(201);
        return ((await response.json()) as { inviteToken: string }).inviteToken;
      };
      const requestSession = (inviteToken: string, nickname: string, roomCode?: string) =>
        fetch(`${endpoint}/api/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
          body: JSON.stringify({
            nickname,
            inviteToken,
            createRoom: !roomCode,
            ...(roomCode ? { roomCode } : {}),
          }),
        });

      const sdk = new Client(endpoint);
      const players: {
        runtime: ReturnType<typeof bindProductRoom>;
        grants: MediaGrant[];
      }[] = [];
      for (let r = 0; r < rooms; r++) {
        const inviteToken = await issueInvite();
        let roomCode: string | undefined;
        for (let seat = 0; seat < 6; seat++) {
          const response = await requestSession(inviteToken, `방${r + 1}-${seat + 1}`, roomCode);
          expect(response.status).toBe(201);
          const session = sessionResponseSchema.parse(await response.json());
          roomCode = session.roomCode;
          const room = await sdk.joinOrCreate<PublicMatchState>(PRODUCT_ROOM_NAME, {
            token: session.sessionToken,
            roomCode,
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
        }
      }
      const timer = setInterval(() => players.forEach((player) => player.runtime.poll()), 20);
      closers.push(async () => clearInterval(timer));

      const summary = () =>
        players.map((player) => {
          const snapshot = player.runtime.getSnapshot();
          return { phase: snapshot.round?.phase, error: snapshot.error };
        });
      const waitAll = (phase: string, timeout: number) =>
        expect
          .poll(summary, { timeout, interval: 100 })
          .toEqual(players.map(() => ({ phase, error: null })))
          .catch(async (cause: unknown) => {
            const inspection = await server.inspect();
            throw new Error(
              JSON.stringify({
                expectedPhase: phase,
                phases: summary().map((entry) => entry.phase),
                errors: summary().filter((entry) => entry.error !== null).length,
                rooms: inspection.rooms,
                readiness: inspection.readiness,
                maxTickMs: inspection.maxTickMs,
                maxEventLoopLagMs: inspection.maxEventLoopLagMs,
              }),
              { cause },
            );
          });

      await waitAll('DEVICE_CHECK', 30_000);
      for (const player of players) {
        await player.runtime.startDevices(false);
        player.runtime.ready(true);
      }
      await waitAll('TEAM_PRACTICE', 30_000);
      await expect
        .poll(() => players.every((player) => player.grants.length >= 1), { timeout: 30_000 })
        .toBe(true);
      // Every room leaves practice together so map finalizing and loading overlap across rooms.
      for (const player of players)
        player.runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } });
      await waitAll('PLAYING', 90_000);
      const afterLoading = await server.inspect();

      await sleep(playingMs);
      expect(summary()).toEqual(players.map(() => ({ phase: 'PLAYING', error: null })));
      const final = await server.inspect();
      expect(final.rooms).toHaveLength(rooms);
      expect(final.rooms.every((room) => room.phase === 'PLAYING')).toBe(true);
      expect(final.readiness).toMatchObject({ state: 'READY', reasonCodes: [] });

      // A room beyond the configured capacity is refused without disturbing running matches.
      const overflow = await requestSession(await issueInvite(), '초과');
      expect(overflow.status).toBe(503);
      expect(await overflow.json()).toMatchObject({ error: 'CAPACITY' });

      // Safe diagnostics only: counts, timings and allowlisted phases, no scope IDs or tokens.
      const report = JSON.stringify({
        multiRoomCapacity: {
          rooms,
          players: players.length,
          playingMs,
          maxTickMs: final.maxTickMs,
          maxEventLoopLagMs: final.maxEventLoopLagMs,
          loadingMaxTickMs: afterLoading.maxTickMs,
          loadingMaxEventLoopLagMs: afterLoading.maxEventLoopLagMs,
          apiUsage: final.apiUsage,
          participantCount: final.participantCount,
          probeWorst: final.probe.worst.slice(0, 3).map((window) => ({
            phase: `${window.phaseBefore}->${window.phaseAfter}`,
            lagMs: Math.round(window.lagMs),
            cpuUserMs: Math.round(window.cpuUserMs),
          })),
        },
      });
      console.info(report);
      if (process.env.KKAKKUNG_TEST_REPORT)
        await writeFile(process.env.KKAKKUNG_TEST_REPORT, `${report}\n`);
      expect(final.maxTickMs).toBeLessThan(OVERLOAD_MS);
      expect(final.maxEventLoopLagMs).toBeLessThan(OVERLOAD_MS);
    }, 600_000);
  },
);
