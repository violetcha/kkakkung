// B's real HTTP/Colyseus room + E's real issuer/registry/transition. A map/core and Cloud
// transport/evidence are explicit local fixtures; this proves ordering, not Cloud acceptance.
import { randomUUID } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import { expect, it } from 'vitest';
import {
  MEDIA_ROUTES,
  PRODUCT_CLIENT_MESSAGES,
  PRODUCT_SERVER_MESSAGES,
  mediaGrantSchema,
  sessionResponseSchema,
  type CommandOutcome,
  type GameHeartbeat,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { createMediaCoordinator } from '../../src/media/MediaCoordinator.js';
import { INVITATION_ROUTES } from '../../src/session/invite-types.js';
import { deferred } from '../media/generation-fixtures.js';
import { productCloudFixture } from '../media/product-cloud-fixture.js';
import {
  bootProductApplication,
  fakeMapPorts,
  TEST_OPS_TOKEN,
  writeLayoutFiles,
} from './test-harness.js';

it('waits for first grants and in-flight E preparation before retiring practice, preserving the next cursor', async () => {
  const cloud = await productCloudFixture();
  const files = await writeLayoutFiles(cloud.config.opsDataDir);
  const maps = fakeMapPorts();
  const allocated = deferred<void>();
  const release = deferred<void>();
  let heldPlayerId = '';
  let held = false;
  let failedPlayerId = '';
  const app = await bootProductApplication({
    layouts: { ...maps, ...files, templateId: 'test-template', templateVersion: 'v1' },
    mediaConfig: cloud.config,
    createMediaCoordinator: (deps) => {
      const media = createMediaCoordinator(
        {
          ...deps,
          enqueueBindings: (playerId, value) =>
            deps.enqueueBindings(playerId, {
              ...value,
              participants: value.participants.map((entry) => ({ ...entry })),
            }),
          enqueueAudioPolicy: (playerId, value) =>
            deps.enqueueAudioPolicy(playerId, {
              ...value,
              voices: value.voices.map((entry) => ({ ...entry })),
              effects: value.effects.map((entry) => ({ ...entry })),
            }),
        },
        cloud.services,
      );
      const prepare = media.prepareGeneration.bind(media);
      media.prepareGeneration = async (request) => {
        const result = await prepare(request);
        if (request.playerId === failedPlayerId) throw new Error('SYNTHETIC_LATE_PRODUCER_FAILURE');
        if (request.playerId === heldPlayerId && !held) {
          held = true;
          allocated.resolve();
          await release.promise;
        }
        return result;
      };
      return media;
    },
  });
  const players: {
    session: SessionResponse;
    room: Room<unknown, PublicMatchState>;
    outcomes: CommandOutcome[];
  }[] = [];
  try {
    await expect.poll(() => app.application.media!.getReadiness().state).toBe('READY');
    const resumeId = randomUUID();
    const resume = await fetch(app.endpoint + '/api/operations/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_OPS_TOKEN}` },
      body: JSON.stringify({ requestId: resumeId, action: 'resume' }),
    });
    expect(resume.status).toBe(202);
    await expect
      .poll(() => app.application.media!.getOperations().getSnapshot(resumeId)?.status)
      .toBe('succeeded');
    const invitation = await fetch(app.endpoint + INVITATION_ROUTES.issue, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_OPS_TOKEN}` },
      body: JSON.stringify({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: Date.now() + 60000,
      }),
    });
    expect(invitation.status).toBe(201);
    const { inviteToken } = (await invitation.json()) as { inviteToken: string };
    const sdk = new Client(app.endpoint);
    let roomCode: string | undefined;
    for (let index = 0; index < 6; index++) {
      const response = await fetch(app.endpoint + '/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nickname: `장벽${index}`,
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
      const outcomes: CommandOutcome[] = [];
      room.onMessage(PRODUCT_SERVER_MESSAGES.commandOutcome, (outcome: CommandOutcome) =>
        outcomes.push(outcome),
      );
      room.onMessage(PRODUCT_SERVER_MESSAGES.heartbeat, (heartbeat: GameHeartbeat) =>
        room.send(PRODUCT_CLIENT_MESSAGES.heartbeatAck, {
          serverEpoch: heartbeat.serverEpoch,
          matchId: heartbeat.matchId,
          heartbeatSeq: heartbeat.heartbeatSeq,
        }),
      );
      room.onMessage('*', () => undefined);
      players.push({ session, room, outcomes });
    }
    const serverRoom = app.application.directory.get(roomCode!)!;
    const serverPhase = () => ('phase' in serverRoom ? serverRoom.phase : null);
    const waitPhase = (phase: string) =>
      expect.poll(() => players[0]!.room.state.phase, { timeout: 15000 }).toBe(phase);
    const send = (type: 'READY' | 'PRACTICE_READY', sequence: number) => {
      for (const player of players)
        player.room.send(PRODUCT_CLIENT_MESSAGES.command, {
          matchId: serverRoom.matchId,
          requestId: randomUUID(),
          sequence,
          type,
          payload: { ready: true },
        });
    };
    const request = async (
      index: number,
      purpose: 'practice' | 'game',
      previousReceiverGeneration?: number,
    ) => {
      const player = players[index]!;
      const response = await fetch(app.endpoint + MEDIA_ROUTES.grants, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${player.session.sessionToken}`,
        },
        body: JSON.stringify({
          matchId: serverRoom.matchId,
          purpose,
          ...(previousReceiverGeneration === undefined ? {} : { previousReceiverGeneration }),
        }),
      });
      // Assert status separately so failed assertions never serialize grant tokens.
      expect(response.status).toBe(200);
      return mediaGrantSchema.parse(await response.json());
    };
    await waitPhase('DEVICE_CHECK');
    send('READY', 1);
    // S15P21C204-295. 전원 준비가 적용된 뒤 방장이 직접 시작한다.
    await expect
      .poll(() =>
        players.every((p) =>
          p.outcomes.some((outcome) => outcome.sequence === 1 && outcome.result === 'applied'),
        ),
      )
      .toBe(true);
    players[0]!.room.send(PRODUCT_CLIENT_MESSAGES.command, {
      matchId: serverRoom.matchId,
      requestId: randomUUID(),
      sequence: 2,
      type: 'ROOM_START',
      payload: {},
    });
    await waitPhase('TEAM_PRACTICE');
    send('PRACTICE_READY', 3);
    await expect
      .poll(() =>
        players.every((p) =>
          p.outcomes.some((outcome) => outcome.sequence === 3 && outcome.result === 'applied'),
        ),
      )
      .toBe(true);
    // Even with no pending HTTP yet, all six initial media scopes must be prepared first.
    expect(serverPhase()).toBe('TEAM_PRACTICE');
    heldPlayerId = players[5]!.session.playerId;
    const firstFive = await Promise.all(
      players.slice(0, 5).map((_, index) => request(index, 'practice')),
    );
    const sixth = request(5, 'practice');
    await allocated.promise;
    const allocatedTick = players[5]!.room.state.serverTick;
    await expect.poll(() => players[5]!.room.state.serverTick).toBeGreaterThan(allocatedTick);
    expect(serverPhase()).toBe('TEAM_PRACTICE');
    // E already allocated and queued ready, while the B prepare/HTTP promise is unresolved.
    release.resolve();
    const grants = [...firstFive, await sixth];
    expect(grants.map((grant) => grant.receiverGeneration)).toEqual([1, 1, 1, 1, 1, 1]);
    await expect.poll(serverPhase).toBe('MAP_FINALIZING');
    for (const [index, grant] of grants.entries()) {
      const response = await fetch(app.endpoint + MEDIA_ROUTES.report, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${players[index]!.session.sessionToken}`,
        },
        body: JSON.stringify({
          matchId: grant.matchId,
          mediaInstanceId: grant.mediaInstanceId,
          receiverGeneration: grant.receiverGeneration,
          status: 'closed',
        }),
      });
      // A late ready response's exact issued scope remains authorized for local closed.
      expect(response.status).toBe(204);
    }
    await waitPhase('GAME_LOADING');
    const next = await request(5, 'game', grants[5]!.receiverGeneration);
    expect(next.receiverGeneration).toBe(2);
    expect(next.mediaInstanceId).not.toBe(grants[5]!.mediaInstanceId);
    expect(serverPhase()).toBe('GAME_LOADING');
    // A producer may throw after its ready callback was queued. The ready callback must not
    // mask the unresolved outcome and reopen the same match with an inferred cursor.
    failedPlayerId = players[0]!.session.playerId;
    const failed = await fetch(app.endpoint + MEDIA_ROUTES.grants, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${players[0]!.session.sessionToken}`,
      },
      body: JSON.stringify({
        matchId: serverRoom.matchId,
        purpose: 'game',
        previousReceiverGeneration: 1,
      }),
    });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({ error: 'TIMEOUT' });
    await waitPhase('ABORTED');
    expect(players[0]!.room.state.abortReason).toBe('MEDIA_UNAVAILABLE');
  } finally {
    release.resolve();
    await Promise.allSettled(players.map((player) => player.room.leave()));
    await app.application.close();
    await cloud.close();
  }
}, 30000);
