/**
 * Room-level regression for F-REQ-15 (S15P21C204-235). A tick that throws must abort only its own
 * room while every other room in the same process keeps ticking. `tick-coordinator.test.ts` covers
 * the coordinator's own containment and its "not replayed until rearm" half; this covers
 * `KkakkungRoom`'s `onTickFailed` wiring, which is what turned one room's throw into a process
 * exit that dropped 10 rooms in QA-10.
 *
 * The fault is armed on the read that follows the step which consumed one known request, so the
 * aborting tick always has a frozen, still-pending command to cancel. `core.stepMatch` throws are
 * already contained by the driver; `core.getFrame` is the read that escaped to the interval.
 *
 * Media generations are out of scope here: this profile boots with `mediaConfig: null`, so no
 * media instance is ever attached to a round and `retireGeneration` is unreachable. The abort
 * retirement path is covered where media is real, in `media-transition-barrier.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRODUCT_CLIENT_MESSAGES,
  PRODUCT_SERVER_MESSAGES,
  sessionResponseSchema,
  type CommandOutcome,
  type PrivateViewMessage,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import { readPublicRoundState, type PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import type { CoreCommand } from '../../src/game/ports.js';
import { INVITATION_ROUTES } from '../../src/session/invite-types.js';
import {
  FakeCore,
  TEST_OPS_TOKEN,
  bootProductApplication,
  fakeMapPorts,
  writeLayoutFiles,
} from './test-harness.js';

type Connection = {
  room: Room<unknown, PublicMatchState>;
  outcomes: CommandOutcome[];
  views: PrivateViewMessage[];
};

describe('room tick fault isolation', () => {
  let app: Awaited<ReturnType<typeof bootProductApplication>>;
  let core: FakeCore;
  let sdk: Client;
  let inviteToken: string;
  const connections: Connection[] = [];
  /** The request whose step arms the fault. Null until the test deliberately breaks one room. */
  let faultRequestId: string | null = null;

  /** True once the core has stepped the armed request, i.e. the batch holding it is frozen. */
  function stepped(requestId: string): boolean {
    return core.calls.some(
      (call) =>
        call.method === 'stepMatch' &&
        (call.args as { commands: readonly CoreCommand[] }).commands.some(
          (command) => command.requestId === requestId,
        ),
    );
  }

  beforeAll(async () => {
    const files = await writeLayoutFiles(join(tmpdir(), `kkakkung-tick-${randomUUID()}`));
    const ports = fakeMapPorts();
    core = new FakeCore({
      endOnEscapes: true,
      failGetFrame: () => faultRequestId !== null && stepped(faultRequestId),
    });
    app = await bootProductApplication({
      core,
      layouts: {
        maps: ports.maps,
        selection: ports.selection,
        masterPath: files.masterPath,
        fallbackPath: files.fallbackPath,
        templateId: 'test-template',
        templateVersion: 'v1',
      },
    });
    sdk = new Client(app.endpoint);
    const issued = await fetch(app.endpoint + INVITATION_ROUTES.issue, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_OPS_TOKEN}` },
      body: JSON.stringify({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: Date.now() + 60_000,
      }),
    });
    expect(issued.status).toBe(201);
    inviteToken = ((await issued.json()) as { inviteToken: string }).inviteToken;
  });

  afterAll(async () => {
    faultRequestId = null;
    await Promise.allSettled(connections.map((entry) => entry.room.leave()));
    await app.application.close();
  });

  async function session(nickname: string, roomCode?: string) {
    const response = await fetch(`${app.endpoint}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify(
        roomCode
          ? { nickname, inviteToken, createRoom: false, roomCode }
          : { nickname, inviteToken, createRoom: true },
      ),
    });
    expect(response.status).toBe(201);
    return sessionResponseSchema.parse(await response.json());
  }

  async function joinRoom(entry: SessionResponse): Promise<Connection> {
    const room = await sdk.joinOrCreate<unknown, PublicMatchState>(PRODUCT_ROOM_NAME, {
      token: entry.sessionToken,
      roomCode: entry.roomCode,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    });
    const connection: Connection = { room, outcomes: [], views: [] };
    room.onMessage(PRODUCT_SERVER_MESSAGES.commandOutcome, (outcome: CommandOutcome) =>
      connection.outcomes.push(outcome),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.privateView, (view: PrivateViewMessage) =>
      connection.views.push(view),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.heartbeat, (heartbeat) =>
      room.send(PRODUCT_CLIENT_MESSAGES.heartbeatAck, {
        serverEpoch: heartbeat.serverEpoch,
        matchId: heartbeat.matchId,
        heartbeatSeq: heartbeat.heartbeatSeq,
      }),
    );
    room.onMessage('*', () => undefined);
    connections.push(connection);
    return connection;
  }

  // The suite boots a server and drives seven clients across two rooms, so it needs room when the
  // whole test run is competing for CPU.
  it(
    'aborts only the faulting room and leaves the other room ticking',
    { timeout: 60_000 },
    async () => {
      const hostEntry = await session('하나');
      const faulting = [await joinRoom(hostEntry)];
      for (const name of ['둘', '셋', '넷', '다섯', '여섯'])
        faulting.push(await joinRoom(await session(name, hostEntry.roomCode)));
      const host = faulting[0]!;

      // A second real room in the same process. It never faults and must survive untouched.
      const bystanderEntry = await session('일곱');
      expect(bystanderEntry.roomCode).not.toBe(hostEntry.roomCode);
      const bystander = await joinRoom(bystanderEntry);

      await expect.poll(() => host.room.state.phase, { timeout: 20_000 }).toBe('DEVICE_CHECK');
      faulting.forEach((entry, index) =>
        entry.room.send(PRODUCT_CLIENT_MESSAGES.command, {
          matchId: entry.room.state.matchId,
          requestId: randomUUID(),
          sequence: 10 + index,
          type: 'READY',
          payload: { ready: true },
        }),
      );
      // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작한다. 준비 보고가
      // 아직 다 적용되기 전이면 거절되므로, 단계가 바뀔 때까지 다시 누른다.
      let startSequence = 20;
      await expect
        .poll(
          () => {
            host.room.send(PRODUCT_CLIENT_MESSAGES.command, {
              matchId: host.room.state.matchId,
              requestId: randomUUID(),
              sequence: startSequence++,
              type: 'ROOM_START',
              payload: {},
            });
            return host.room.state.phase;
          },
          { timeout: 20_000 },
        )
        .toBe('TEAM_PRACTICE');
      await expect
        .poll(() => bystander.room.state.serverTick, { timeout: 10_000 })
        .toBeGreaterThan(0);
      const bystanderBefore = bystander.room.state.serverTick;

      // Arm the fault on this request: the tick that steps it is the tick whose read throws, so
      // the request is frozen and still pending when the room aborts.
      const armed = randomUUID();
      faultRequestId = armed;
      host.room.send(PRODUCT_CLIENT_MESSAGES.command, {
        matchId: host.room.state.matchId,
        requestId: armed,
        // 시작 명령을 여러 번 보냈으므로 그 뒤 번호를 이어 쓴다.
        sequence: startSequence++,
        type: 'MOVE_INTENT',
        payload: { direction: 'forward' },
      });

      await expect.poll(() => host.room.state.phase, { timeout: 20_000 }).toBe('ABORTED');
      expect(readPublicRoundState(host.room.state).abortReason).toBe('SERVER_TICK_OVERLOAD');

      // The request frozen by the failed tick is canceled, not left pending.
      await expect
        .poll(() => host.outcomes.find((outcome) => outcome.requestId === armed), {
          timeout: 10_000,
        })
        .toMatchObject({ result: 'canceled', code: 'ROUND_ENDED' });

      // Every participant's attached instance is detached: the last private view has no scope.
      for (const entry of faulting)
        await expect
          .poll(() => entry.views.at(-1)?.gameScope.kind, { timeout: 10_000 })
          .toBe('none');

      // The other room kept ticking across the fault, which also proves the process and the
      // interval survived.
      expect(bystander.room.state.phase).not.toBe('ABORTED');
      await expect
        .poll(() => bystander.room.state.serverTick, { timeout: 10_000 })
        .toBeGreaterThan(bystanderBefore + 5);

      // The faulting room re-armed: without `rearm` the coordinator leaves it overloaded and its
      // published tick never moves again.
      const faultedAt = host.room.state.serverTick;
      await expect
        .poll(() => host.room.state.serverTick, { timeout: 10_000 })
        .toBeGreaterThan(faultedAt);
      expect(readPublicRoundState(host.room.state).abortReason).toBe('SERVER_TICK_OVERLOAD');
    },
  );
});
