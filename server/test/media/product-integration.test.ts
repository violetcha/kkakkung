// Real A content/rules + B authenticated HTTP/Colyseus + C product runtime + E operations.
// A/B/E/F run in a child process; the six C/SDK clients run here on a separate event loop.
// Only D devices and Cloud transport/evidence are synthetic; this is NOT G5/Cloud acceptance
// or a wall-clock load test. The real 3600-tick round is advanced locally.
import { createHash, randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MEDIA_ROUTES,
  mediaBindingsSchema,
  sessionResponseSchema,
  type MediaGrant,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { bindProductRoom } from '../../../apps/web/src/app/product-runtime';
import { productRoomPort } from '../../../apps/web/src/features/room/product-session';
import {
  createSyntheticInteractionFactory,
  type SyntheticMediaControl,
} from '../../../apps/web/src/app/product-integration-fixture';
import { INVITATION_ROUTES } from '../../src/session/invite-types.js';
import { startProductServerProcess } from './product-server-process.js';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

describe('local product integration with synthetic device/Cloud boundaries', () => {
  it('completes swap and same rematches, replaces a player, and recovers from host loss', async () => {
    const opsToken = randomUUID();
    const server = await startProductServerProcess(opsToken, {
      cpuProfile: process.env.KKAKKUNG_TEST_CPU_PROFILE === '1',
    });
    closers.push(() => server.close());
    expect(server.strictProduct).toBe(true);
    expect(server.pid).not.toBe(process.pid);
    const endpoint = server.endpoint;
    const operator = { authorization: `Bearer ${opsToken}`, 'content-type': 'application/json' };
    await expect
      .poll(async () => (await server.inspect()).readiness, { timeout: 5000 })
      .toMatchObject({ state: 'READY', reasonCodes: [] });
    expect((await fetch(`${endpoint}/health/ready`)).status).toBe(200);
    expect((await fetch(`${endpoint}/api/dev/session`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${endpoint}/api/operations/status`)).status).toBe(403);
    const requestId = randomUUID();
    expect(
      (
        await fetch(`${endpoint}/api/operations/commands`, {
          method: 'POST',
          headers: operator,
          body: JSON.stringify({ requestId, action: 'resume' }),
        })
      ).status,
    ).toBe(202);
    await expect
      .poll(
        async () => {
          const response = await fetch(`${endpoint}/api/operations/commands/${requestId}`, {
            headers: operator,
          });
          return ((await response.json()) as { status: string }).status;
        },
        { timeout: 5000 },
      )
      .toBe('succeeded');
    const inviteResponse = await fetch(endpoint + INVITATION_ROUTES.issue, {
      method: 'POST',
      headers: operator,
      body: JSON.stringify({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: Date.now() + 240000,
      }),
    });
    expect(inviteResponse.status).toBe(201);
    const { inviteToken } = (await inviteResponse.json()) as { inviteToken: string };
    const sdk = new Client(endpoint);
    const players: {
      session: SessionResponse;
      room: Room<unknown, PublicMatchState>;
      runtime: ReturnType<typeof bindProductRoom>;
      grants: MediaGrant[];
      phases: Set<string>;
      bindingStats: { generation: number; selfFace: boolean }[];
      mediaControl: SyntheticMediaControl;
    }[] = [];
    const reports: { code: number; status: string }[] = [];
    const grantResults: { status: number; code: string | null }[] = [];
    let roomCode: string | undefined;
    const identityHash = (identity: string) => createHash('sha256').update(identity).digest('hex');
    let joinedCount = 0;
    const joinPlayer = async () => {
      const response = await fetch(`${endpoint}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
        body: JSON.stringify({
          nickname: `통합${++joinedCount}`,
          inviteToken,
          createRoom: !roomCode,
          ...(roomCode ? { roomCode } : {}),
        }),
      });
      expect(response.status).toBe(201);
      const session = sessionResponseSchema.parse(await response.json());
      roomCode = session.roomCode;
      const room = await sdk.joinOrCreate<PublicMatchState>(PRODUCT_ROOM_NAME, {
        token: session.sessionToken,
        roomCode,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
      });
      const grants: MediaGrant[] = [];
      let mediaControl!: SyntheticMediaControl;
      const phases = new Set<string>();
      const bindingStats: { generation: number; selfFace: boolean }[] = [];
      room.onMessage('media-bindings', (value: unknown) => {
        const parsed = mediaBindingsSchema.parse(value);
        bindingStats.push({
          generation: parsed.receiverGeneration,
          selfFace: parsed.participants.some(
            (participant) =>
              participant.playerId === session.playerId && !!participant.faceTrackSid,
          ),
        });
      });
      const fetcher: typeof fetch = async (input, init) => {
        const url = String(input);
        const result = await fetch(url.startsWith('/') ? endpoint + url : input, init);
        if (url === MEDIA_ROUTES.report)
          reports.push({
            code: result.status,
            status: JSON.parse(String(init?.body)).status as string,
          });
        if (url === MEDIA_ROUTES.grants) {
          const body = result.ok ? null : ((await result.clone().json()) as { error?: unknown });
          grantResults.push({
            status: result.status,
            code:
              typeof body?.error === 'string' && /^[A-Z_]+$/.test(body.error) ? body.error : null,
          });
        }
        return result;
      };
      const runtime = bindProductRoom(productRoomPort(room), session, {
        now: () => performance.now(),
        uuid: randomUUID,
        changed: (snapshot) => {
          if (snapshot.round) phases.add(snapshot.round.phase);
        },
        fetcher,
        interactionFactory: createSyntheticInteractionFactory({
          control: (control) => {
            mediaControl = control;
          },
          publish: async (grant) => {
            grants.push(grant);
            await server.publish(grant);
            return `FACE_${grant.mediaIdentity}`;
          },
        }),
      });
      room.onMessage('*', () => {});
      players.push({ session, room, runtime, grants, phases, bindingStats, mediaControl });
      closers.push(() => runtime.leave());
    };
    for (let i = 0; i < 6; i++) await joinPlayer();
    const timer = setInterval(() => players.forEach((player) => player.runtime.poll()), 20);
    closers.push(async () => clearInterval(timer));
    const snapshots = () => players.map((player) => player.runtime.getSnapshot());
    const waitPhase = (phase: string) =>
      expect
        .poll(
          () =>
            snapshots().map((snapshot) => ({
              phase: snapshot.round?.phase,
              error: snapshot.error,
            })),
          {
            timeout: 15000,
          },
        )
        .toEqual(players.map(() => ({ phase, error: null })))
        .catch(async (cause: unknown) => {
          throw new Error(
            JSON.stringify({
              expectedPhase: phase,
              actual: snapshots().map((snapshot) => ({
                phase: snapshot.round?.phase,
                error: snapshot.error,
                abort: snapshot.round?.abortReason,
                lost: snapshot.lost,
              })),
              reports,
              grantResults,
              server: await server.inspect(roomCode),
            }),
            { cause },
          );
        });
    await waitPhase('DEVICE_CHECK');
    for (const player of players) {
      await player.runtime.startDevices(false);
      player.runtime.ready(true);
    }
    await waitPhase('TEAM_PRACTICE');
    await expect
      .poll(() => players.every((player) => player.grants.length === 1), { timeout: 10000 })
      .toBe(true);
    expect(new Set(players.map((player) => player.grants[0]!.mediaInstanceId)).size).toBe(2);
    await expect.poll(async () => (await server.inspect()).participantCount).toBe(6);
    for (const snapshot of snapshots()) expect(snapshot.error).toBeNull();
    const oldGrants = players.map((player) => player.grants[0]!);
    for (const player of players)
      player.runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } });
    try {
      await waitPhase('PLAYING');
    } catch (failure) {
      throw new Error(
        JSON.stringify({
          snapshots: snapshots().map((s, index) => ({
            phase: s.round?.phase,
            rawPhase: players[index]!.room.state.phase,
            abortReason: s.round?.abortReason,
            phases: [...players[index]!.phases],
            lost: s.lost,
            error: s.error,
            practiceReadyStatus: s.requests.PRACTICE_READY?.status,
            grants: players[index]!.grants.length,
          })),
          reports,
          grantResults,
          loading: snapshots().map((snapshot, i) => ({
            bindings: players[i]!.bindingStats.slice(-2),
            loadReady: snapshot.requests.LOAD_READY?.status,
            asset:
              snapshot.view?.self?.status === 'ACTIVE'
                ? snapshot.view.self.loading?.assetVersion
                : null,
            loadingGeneration:
              snapshot.view?.self?.status === 'ACTIVE'
                ? snapshot.view.self.loading?.receiverGeneration
                : null,
            mediaState: snapshot.media?.state,
            mediaGeneration: snapshot.media?.receiverGeneration,
          })),
          server: await server.inspect(roomCode),
        }),
        { cause: failure },
      );
    }
    await expect
      .poll(() => players.every((player) => player.grants.length === 2), { timeout: 5000 })
      .toBe(true);
    const afterPractice = await server.inspect();
    for (const grant of oldGrants)
      expect(afterPractice.removedIdentityHashes).toContain(identityHash(grant.mediaIdentity));
    expect(new Set(players.map((player) => player.grants[1]!.mediaInstanceId)).size).toBe(1);
    for (const [index, player] of players.entries()) {
      expect(player.grants[1]!.receiverGeneration).toBeGreaterThan(
        oldGrants[index]!.receiverGeneration,
      );
      for (const phase of ['TEAM_PRACTICE', 'GAME_LOADING', 'COUNTDOWN', 'PLAYING'])
        expect(player.phases.has(phase)).toBe(true);
    }
    expect(reports.filter((report) => report.status === 'closed').length).toBeGreaterThanOrEqual(6);
    expect(reports.every((report) => report.code === 204)).toBe(true);
    const playing = snapshots()[0]!.round!;
    const previousRoles = snapshots().map((snapshot) => snapshot.view!.self!.role);
    expect(playing.deadlineTick! - playing.startTick!).toBe(3600);
    const recovering = players[1]!;
    const logicalScope = structuredClone(recovering.runtime.getSnapshot().view!.gameScope);
    const beforeRecovery = recovering.grants[1]!;
    expect(recovering.mediaControl.failOnce()).toBe(true);
    await expect.poll(() => recovering.grants.length, { timeout: 8000 }).toBe(3);
    const afterRecovery = recovering.grants[2]!;
    expect(afterRecovery.mediaInstanceId).toBe(beforeRecovery.mediaInstanceId);
    expect(afterRecovery.receiverGeneration).toBeGreaterThan(beforeRecovery.receiverGeneration);
    expect(afterRecovery.mediaIdentity).not.toBe(beforeRecovery.mediaIdentity);
    await expect
      .poll(() => recovering.bindingStats.at(-1), { timeout: 8000 })
      .toEqual({
        generation: afterRecovery.receiverGeneration,
        selfFace: true,
      });
    expect(recovering.runtime.getSnapshot().view!.gameScope).toEqual(logicalScope);
    expect(
      players.filter((_, index) => index !== 1).every((player) => player.grants.length === 2),
    ).toBe(true);
    expect((await server.inspect()).removedIdentityHashes).toContain(
      identityHash(beforeRecovery.mediaIdentity),
    );
    await waitPhase('PLAYING');
    // The child advances every authoritative tick with IO yields; real timers/gates remain active.
    await server.advanceTicks(roomCode!, 3650);
    await waitPhase('RESULT');
    expect(snapshots()[0]!.round?.result).toEqual({ winner: 'taggers', reason: 'timeout' });
    await expect
      .poll(async () => (await server.inspect()).participantCount, { timeout: 5000 })
      .toBe(0);
    await expect.poll(() => reports.filter((report) => report.status === 'closed').length).toBe(13);
    const previousMatch = playing.matchId;
    const hostId = snapshots()[0]!.roster!.hostId;
    players
      .find((player) => player.session.playerId === hostId)!
      .runtime.send({ type: 'REMATCH', payload: { mode: 'swap' } });
    await waitPhase('DEVICE_CHECK');
    expect(snapshots().every((snapshot) => snapshot.round?.matchId !== previousMatch)).toBe(true);
    expect(snapshots().every((snapshot) => !snapshot.lost && snapshot.round?.result === null)).toBe(
      true,
    );
    const playNextRound = async () => {
      for (const player of players) {
        await player.runtime.startDevices(false);
        player.runtime.ready(true);
      }
      await waitPhase('TEAM_PRACTICE');
      await expect
        .poll(async () => (await server.inspect()).participantCount, { timeout: 8000 })
        .toBe(6)
        .catch(async (cause: unknown) => {
          const inspection = await server.inspect(roomCode);
          throw new Error(
            JSON.stringify({
              phase: snapshots().map((s) => s.round?.phase),
              error: snapshots().map((s) => s.error),
              media: snapshots().map((s) => ({ state: s.media?.state, code: s.media?.code })),
              recentGrantResults: grantResults.slice(-6),
              participants: inspection.participantCount,
              readiness: inspection.readiness,
              blockedReason: inspection.blockedReason,
            }),
            { cause },
          );
        });
      for (const player of players)
        player.runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } });
      await waitPhase('PLAYING');
    };
    const finishRound = async () => {
      await server.advanceTicks(roomCode!, 3650);
      await waitPhase('RESULT');
      expect(snapshots().every((s) => s.round?.result?.reason === 'timeout')).toBe(true);
      await expect
        .poll(async () => (await server.inspect()).participantCount, { timeout: 8000 })
        .toBe(0);
    };
    const rematch = async (mode: 'same' | 'swap' | 'lobby') => {
      const oldMatchId = snapshots()[0]!.round!.matchId;
      const currentHost = snapshots()[0]!.roster!.hostId;
      players
        .find((player) => player.session.playerId === currentHost)!
        .runtime.send({ type: 'REMATCH', payload: { mode } });
      await waitPhase('DEVICE_CHECK');
      expect(snapshots().every((s) => s.round!.matchId !== oldMatchId)).toBe(true);
    };
    await playNextRound();
    expect(snapshots().map((s) => s.view!.self!.role)).toEqual(
      previousRoles.map((role) => (role === 'runner' ? 'tagger' : 'runner')),
    );
    const swappedRoles = snapshots().map((s) => s.view!.self!.role);
    await finishRound();
    await rematch('same');
    await playNextRound();
    expect(snapshots().map((s) => s.view!.self!.role)).toEqual(swappedRoles);
    await finishRound();

    // A confirmed old generation must not pin the next round when a seat is replaced.
    await rematch('lobby');
    const replaced = players.pop()!;
    await replaced.runtime.leave();
    await waitPhase('LOBBY');
    await joinPlayer();
    await waitPhase('DEVICE_CHECK');
    await playNextRound();
    await finishRound();

    // ACTIVE game-socket loss aborts this round; it is not media-only recovery.
    await rematch('same');
    await playNextRound();
    const departedHostId = snapshots()[0]!.roster!.hostId;
    const hostIndex = players.findIndex((player) => player.session.playerId === departedHostId);
    const departedHost = players.splice(hostIndex, 1)[0]!;
    await departedHost.room.leave();
    await waitPhase('ABORTED');
    await expect(departedHost.runtime.leave()).resolves.toBeUndefined();
    expect(snapshots().every((s) => s.round?.abortReason === 'GAME_CONNECTION_LOST')).toBe(true);
    await expect
      .poll(async () => (await server.inspect()).participantCount, { timeout: 8000 })
      .toBe(0);
    expect(snapshots().every((s) => s.roster!.hostId !== departedHostId)).toBe(true);
    const replacementHost = snapshots()[0]!.roster!.hostId;
    players
      .find((player) => player.session.playerId === replacementHost)!
      .runtime.send({ type: 'REMATCH', payload: { mode: 'lobby' } });
    await waitPhase('LOBBY');
    await joinPlayer();
    await waitPhase('DEVICE_CHECK');
    await playNextRound();
    await finishRound();
    expect(reports.every((report) => report.code === 204)).toBe(true);
    const finalInspection = await server.inspect(roomCode);
    expect(finalInspection.readiness).toMatchObject({ state: 'READY', reasonCodes: [] });
    expect(finalInspection.participantCount).toBe(0);
    // Safe test diagnostics only: numeric timing/CPU/GC and allowlisted phases, no scope IDs.
    console.info(
      JSON.stringify({
        productServerProbe: finalInspection.probe,
        productIntegration: {
          closedReports: reports.filter((report) => report.status === 'closed').length,
          unsuccessfulReports: reports.filter((report) => report.code !== 204).length,
          participantCount: finalInspection.participantCount,
          readiness: finalInspection.readiness?.state,
        },
      }),
    );
    // Five complete rounds plus one aborted round run sequentially, including real countdowns.
    // This is the aggregate test budget; phase deadlines and the 250ms server overload gate stay live.
  }, 180_000);
});
