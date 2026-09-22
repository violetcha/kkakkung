/**
 * End-to-end product room over real Colyseus with the harness FakeCore: invitation → session →
 * join → DEVICE_CHECK → practice → map → loading → countdown → PLAYING → RESULT → rematch.
 * It verifies wire hygiene (no maze/players in the public state, allowlisted private views,
 * exits hidden from taggers) and the accepted→outcome contract. Rule correctness itself is A's.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import {
  PRODUCT_CLIENT_MESSAGES,
  PRODUCT_SERVER_MESSAGES,
  privateViewSchema,
  roomRosterSchema,
  sessionResponseSchema,
  type CommandOutcome,
  type CommandReceipt,
  type PrivateEvent,
  type RoomRosterMessage,
  type SessionResponse,
} from '@kkakkung/protocol/game-messages';
import {
  PUBLIC_MATCH_STATE_FIELDS,
  readPublicRoundState,
  type PrivateView,
  type PublicMatchState,
} from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { INVITATION_ROUTES } from '../../src/session/invite-types.js';
import {
  TEST_OPS_TOKEN,
  bootProductApplication,
  fakeMapPorts,
  writeLayoutFiles,
} from './test-harness.js';

type Player = {
  session: SessionResponse;
  room: Room<unknown, PublicMatchState>;
  views: PrivateView[];
  events: PrivateEvent[];
  receipts: CommandReceipt[];
  outcomes: CommandOutcome[];
  rosters: RoomRosterMessage[];
};

describe('product kkakkung room (0.2.0) with the harness core', () => {
  let app: Awaited<ReturnType<typeof bootProductApplication>>;
  let sdk: Client;
  let inviteToken: string;
  const players: Player[] = [];
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    const files = await writeLayoutFiles(join(tmpdir(), `kkakkung-layout-${randomUUID()}`));
    const ports = fakeMapPorts();
    app = await bootProductApplication({
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
    await Promise.allSettled(players.map((p) => p.room.leave()));
    await app.application.close();
  });

  async function createSession(nickname: string, roomCode?: string) {
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

  async function joinRoom(session: SessionResponse): Promise<Player> {
    const room = await sdk.joinOrCreate<unknown, PublicMatchState>(PRODUCT_ROOM_NAME, {
      token: session.sessionToken,
      roomCode: session.roomCode,
      protocolVersion: PRODUCT_PROTOCOL_VERSION,
    });
    const player: Player = {
      session,
      room,
      views: [],
      events: [],
      receipts: [],
      outcomes: [],
      rosters: [],
    };
    room.onMessage(PRODUCT_SERVER_MESSAGES.privateView, (view: PrivateView) =>
      player.views.push(view),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.privateEvent, (event: PrivateEvent) =>
      player.events.push(event),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.commandResult, (receipt: CommandReceipt) =>
      player.receipts.push(receipt),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.commandOutcome, (outcome: CommandOutcome) =>
      player.outcomes.push(outcome),
    );
    room.onMessage(PRODUCT_SERVER_MESSAGES.roomRoster, (roster: RoomRosterMessage) =>
      player.rosters.push(roster),
    );
    // This wire-level harness bypasses the product runtime, so it must answer liveness probes.
    room.onMessage(PRODUCT_SERVER_MESSAGES.heartbeat, (heartbeat) =>
      room.send(PRODUCT_CLIENT_MESSAGES.heartbeatAck, {
        serverEpoch: heartbeat.serverEpoch,
        matchId: heartbeat.matchId,
        heartbeatSeq: heartbeat.heartbeatSeq,
      }),
    );
    room.onMessage('*', () => undefined);
    players.push(player);
    return player;
  }

  const send = (player: Player, type: string, payload: unknown, sequence: number) => {
    const requestId = randomUUID();
    player.room.send(PRODUCT_CLIENT_MESSAGES.command, {
      matchId: player.room.state.matchId,
      requestId,
      sequence,
      type,
      payload,
    });
    return requestId;
  };
  const waitPhase = (phase: string, timeout = 8000) =>
    expect.poll(() => players[0]!.room.state.phase, { timeout }).toBe(phase);
  const latestView = (player: Player) => player.views.at(-1)!;

  it('admits six invited sessions, refuses a seventh and moves to DEVICE_CHECK', async () => {
    const host = await createSession('하나');
    const first = await joinRoom(host);
    await expect.poll(() => first.rosters.length).toBeGreaterThan(0);
    for (const name of ['둘', '셋', '넷', '다섯', '여섯'])
      await joinRoom(await createSession(name, host.roomCode));
    await waitPhase('DEVICE_CHECK');
    const seventh = await fetch(`${app.endpoint}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: '일곱',
        inviteToken,
        createRoom: false,
        roomCode: host.roomCode,
      }),
    });
    expect(seventh.status).toBe(503);
    // Same session from a second browser is refused while the first connection is active.
    await expect(
      sdk.joinOrCreate(PRODUCT_ROOM_NAME, {
        token: host.sessionToken,
        roomCode: host.roomCode,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
      }),
    ).rejects.toThrow(/SESSION_IN_USE/);
    await expect(
      sdk.joinOrCreate(PRODUCT_ROOM_NAME, {
        token: host.sessionToken,
        roomCode: host.roomCode,
        protocolVersion: '0.1.0',
      }),
    ).rejects.toThrow(/PROTOCOL_MISMATCH/);
    const roster = roomRosterSchema.parse(first.rosters.at(-1));
    expect(roster.players).toHaveLength(6);
    expect(roster.hostId).toBe(host.playerId);
    expect(JSON.stringify(roster)).not.toMatch(/role|"x"|"y"/);
    const publicJson = first.room.state.toJSON() as Record<string, unknown>;
    for (const key of Object.keys(publicJson)) expect(PUBLIC_MATCH_STATE_FIELDS).toContain(key);
    expect(publicJson).not.toHaveProperty('maze');
    expect(publicJson).not.toHaveProperty('players');
  });

  it('rejects READY outside DEVICE_CHECK via outcome and starts team practice when all six report', async () => {
    const [first] = players as [Player, ...Player[]];
    const invalid = send(first, 'MOVE_INTENT', { direction: 'forward' }, 1);
    await expect
      .poll(() => first.receipts.find((r) => r.requestId === invalid)?.status)
      .toBe('rejected');
    expect(first.receipts.find((r) => r.requestId === invalid)?.code).toBe('INVALID_PHASE');
    const forged = send(first, 'READY', { ready: true, playerId: players[1]!.session.playerId }, 2);
    await expect
      .poll(() => first.receipts.find((r) => r.requestId === forged)?.code)
      .toBe('INVALID_COMMAND');
    const ids = players.map((p, i) => send(p, 'READY', { ready: true }, 10 + i));
    for (const [i, player] of players.entries())
      await expect
        .poll(() => player.outcomes.find((o) => o.requestId === ids[i])?.result, { timeout: 5000 })
        .toBe('applied');
    // S15P21C204-295. 전원이 준비해도 저절로 시작하지 않는다. 방장이 시작한다.
    const started = send(first, 'ROOM_START', {}, 16);
    await expect
      .poll(() => first.outcomes.find((o) => o.requestId === started)?.result, { timeout: 5000 })
      .toBe('applied');
    await waitPhase('TEAM_PRACTICE');
    await expect
      .poll(() => players.every((p) => latestView(p)?.gameScope.kind === 'practice'), {
        timeout: 5000,
      })
      .toBe(true);
    const runners = players.filter(
      (p) => latestView(p).self && latestView(p).self!.role === 'runner',
    );
    const taggers = players.filter(
      (p) => latestView(p).self && latestView(p).self!.role === 'tagger',
    );
    expect(runners).toHaveLength(3);
    expect(taggers).toHaveLength(3);
    const runnerInstances = new Set(runners.map((p) => latestView(p).gameScope.gameInstanceId));
    const taggerInstances = new Set(taggers.map((p) => latestView(p).gameScope.gameInstanceId));
    expect(runnerInstances.size).toBe(1);
    expect(taggerInstances.size).toBe(1);
    expect([...runnerInstances][0]).not.toBe([...taggerInstances][0]);
    for (const view of players.map(latestView))
      expect(privateViewSchema.safeParse(view).success).toBe(true);
  });

  it('applies a practice move for the sender only and cancels practice scope on transition', async () => {
    const [first] = players as [Player, ...Player[]];
    const before = latestView(first);
    const requestId = send(first, 'MOVE_INTENT', { direction: 'forward' }, 20);
    await expect
      .poll(() => first.outcomes.find((o) => o.requestId === requestId)?.result, { timeout: 5000 })
      .toBe('applied');
    await expect
      .poll(() => latestView(first).stateVersion, { timeout: 5000 })
      .toBeGreaterThan(before.stateVersion);
    const self = latestView(first).self;
    expect(self && self.status === 'ACTIVE' ? self.cell : null).not.toEqual(
      before.self && before.self.status === 'ACTIVE' ? before.self.cell : null,
    );
    const ids = players.map((p, i) => send(p, 'PRACTICE_READY', { ready: true }, 30 + i));
    for (const [i, player] of players.entries())
      await expect
        .poll(() => player.outcomes.find((o) => o.requestId === ids[i])?.result, { timeout: 5000 })
        .toBe('applied');
    await expect.poll(() => players[0]!.room.state.phase, { timeout: 10_000 }).toBe('GAME_LOADING');
    const scopes = players.map((p) =>
      p.views.map((v) => `${v.gameScope.kind}/${v.gameScope.revision}`),
    );
    for (const history of scopes) {
      expect(history).toContain('practice/1');
      expect(history).toContain('none/2');
      expect(history).toContain('game/3');
    }
    const publicState = readPublicRoundState(first.room.state);
    expect(publicState.phase).toBe('GAME_LOADING');
    expect(publicState.matchId).toBe(before.matchId);
  });

  it('passes the loading barrier with LOAD_READY, counts down and starts PLAYING with a fixed deadline', async () => {
    const [first] = players as [Player, ...Player[]];
    const loadingViews = players.map((p) => latestView(p));
    for (const view of loadingViews)
      expect(
        view.self && view.self.status === 'ACTIVE' ? view.self.loading?.loadId : null,
      ).toBeTruthy();
    const stale = send(
      first,
      'LOAD_READY',
      { loadId: 'old-load', mediaInstanceId: 'x', receiverGeneration: 0 },
      40,
    );
    await expect
      .poll(() => first.outcomes.find((o) => o.requestId === stale)?.code, { timeout: 5000 })
      .toBe('EXPIRED');
    const ids = players.map((p, i) => {
      const view = latestView(p);
      const loading = view.self && view.self.status === 'ACTIVE' ? view.self.loading! : null;
      return send(
        p,
        'LOAD_READY',
        {
          loadId: loading!.loadId,
          mediaInstanceId: loading!.mediaInstanceId,
          receiverGeneration: loading!.receiverGeneration,
        },
        41 + i,
      );
    });
    for (const [i, player] of players.entries())
      await expect
        .poll(() => player.outcomes.find((o) => o.requestId === ids[i])?.result, { timeout: 5000 })
        .toBe('applied');
    await waitPhase('COUNTDOWN');
    const countdown = readPublicRoundState(first.room.state);
    expect(countdown.startAt).not.toBeNull();
    const blocked = send(first, 'MOVE_INTENT', { direction: 'forward' }, 50);
    await expect
      .poll(() => first.receipts.find((r) => r.requestId === blocked)?.code, { timeout: 5000 })
      .toBe('INVALID_PHASE');
    await waitPhase('PLAYING', 10_000);
    const playing = readPublicRoundState(first.room.state);
    expect(playing.startTick).not.toBeNull();
    expect(playing.deadlineTick).toBe(playing.startTick! + 3600);
    await sleep(200);
    expect(readPublicRoundState(first.room.state).deadlineTick).toBe(playing.deadlineTick);
  });

  it('hides exits from taggers, delivers outcomes at the last view version and answers request-status', async () => {
    const runners = players.filter((p) => latestView(p).self?.role === 'runner');
    const taggers = players.filter((p) => latestView(p).self?.role === 'tagger');
    for (const runner of runners)
      expect(latestView(runner).knownActiveExits.map((e) => e.ownerId)).toEqual([
        runner.session.playerId,
      ]);
    for (const tagger of taggers) expect(latestView(tagger).knownActiveExits).toEqual([]);
    const runner = runners[0]!;
    const requestId = send(runner, 'EXIT_START', { exitId: 'exit-x' }, 60);
    await expect
      .poll(() => runner.outcomes.find((o) => o.requestId === requestId), { timeout: 5000 })
      .toBeTruthy();
    const outcome = runner.outcomes.find((o) => o.requestId === requestId)!;
    expect(outcome.result).toBe('rejected');
    expect(outcome.stateVersion).toBe(latestView(runner).stateVersion);
    const statuses: unknown[] = [];
    runner.room.onMessage(PRODUCT_SERVER_MESSAGES.requestStatusResult, (status: unknown) =>
      statuses.push(status),
    );
    runner.room.send(PRODUCT_CLIENT_MESSAGES.requestStatus, {
      matchId: runner.room.state.matchId,
      requestId,
    });
    await expect.poll(() => statuses.length, { timeout: 5000 }).toBe(1);
    expect(statuses[0]).toEqual({
      matchId: runner.room.state.matchId,
      requestId,
      status: 'done',
      outcome,
    });
    // Another player's request id is unknown to this recipient.
    const other = taggers[0]!;
    const otherStatuses: unknown[] = [];
    other.room.onMessage(PRODUCT_SERVER_MESSAGES.requestStatusResult, (status: unknown) =>
      otherStatuses.push(status),
    );
    other.room.send(PRODUCT_CLIENT_MESSAGES.requestStatus, {
      matchId: other.room.state.matchId,
      requestId,
    });
    await expect.poll(() => otherStatuses.length, { timeout: 5000 }).toBe(1);
    expect(otherStatuses[0]).toMatchObject({ status: 'unknown', outcome: null });
  });

  it('ends the round on two escapes, cancels pending, and the host rematch reopens a fresh match', async () => {
    const [first] = players as [Player, ...Player[]];
    const runners = players.filter((p) => latestView(p).self?.role === 'runner');
    const previousMatchId = first.room.state.matchId;
    for (const [i, runner] of runners.slice(0, 2).entries())
      send(runner, 'EXIT_PROGRESS', { challengeId: 'c', method: 'keys', completed: true }, 70 + i);
    await waitPhase('RESULT', 10_000);
    const result = readPublicRoundState(first.room.state);
    expect(result.result).toEqual({ winner: 'runners', reason: 'two-escaped' });
    expect(result.counts.escaped).toBe(2);
    expect(['available', 'settling']).toContain(result.rematchState);
    const ended = latestView(runners[0]!);
    expect(ended.self?.status).toBe('ESCAPED');
    expect(ended.knownTerrain).toEqual([]);
    const notHost = players.find((p) => p.session.playerId !== first.rosters.at(-1)!.hostId)!;
    const denied = send(notHost, 'REMATCH', { mode: 'swap' }, 80);
    await expect
      .poll(() => notHost.outcomes.find((o) => o.requestId === denied)?.code, { timeout: 5000 })
      .toBe('NOT_ALLOWED');
    const host = players.find((p) => p.session.playerId === first.rosters.at(-1)!.hostId)!;
    const accepted = send(host, 'REMATCH', { mode: 'swap' }, 81);
    await expect
      .poll(() => host.outcomes.find((o) => o.requestId === accepted)?.result, { timeout: 5000 })
      .toBe('applied');
    expect(host.outcomes.find((o) => o.requestId === accepted)?.matchId).toBe(previousMatchId);
    await expect.poll(() => first.room.state.matchId, { timeout: 5000 }).not.toBe(previousMatchId);
    await waitPhase('DEVICE_CHECK');
    expect(readPublicRoundState(first.room.state).result).toBeNull();
    expect(readPublicRoundState(first.room.state).startTick).toBeNull();
    expect(readPublicRoundState(first.room.state)).not.toHaveProperty('rematchState');
    // A command for the previous match is refused as WRONG_MATCH.
    const stale = randomUUID();
    first.room.send(PRODUCT_CLIENT_MESSAGES.command, {
      matchId: previousMatchId,
      requestId: stale,
      sequence: 90,
      type: 'READY',
      payload: { ready: true },
    });
    await expect
      .poll(() => first.receipts.find((r) => r.requestId === stale)?.code, { timeout: 5000 })
      .toBe('WRONG_MATCH');
    expect(latestView(first).gameScope).toEqual({
      gameInstanceId: null,
      kind: 'none',
      revision: 0,
    });
  });
});
