import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { ParticipantInfo, Room, TrackInfo, TrackSource, TrackType } from 'livekit-server-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMediaCoordinator,
  type MediaCoordinatorServices,
} from '../../src/media/MediaCoordinator.js';
import type { GatewayClient } from '../../src/media/LiveKitGateway.js';
import { UsageBudget } from '../../src/operations/UsageBudget.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import type {
  MediaCoordinatorDeps,
  MediaGrant,
  PreparationResult,
  PrepareGenerationRequest,
  TrustedMediaFrame,
} from '../../src/media/types.js';
import {
  deferred,
  localCapability,
  localConfiguration,
  practiceFrame,
  prepareRequest,
} from './generation-fixtures.js';

const EPOCH = 1_800_000_000_000;
const closers: (() => Promise<void>)[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const directory of directories.splice(0)) {
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith('kkakkung-e16-factory-')
    )
      throw new Error('UNSAFE_TEST_DIRECTORY');
    await fs.rm(target, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

async function fixture(override: Partial<MediaCoordinatorServices> = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e16-factory-'));
  directories.push(dir);
  const config = { ...localConfiguration(EPOCH), opsDataDir: dir };
  // Synthetic evidence exercises local orchestration. It is not real Cloud authorization proof.
  await fs.writeFile(path.join(dir, 'capability-report.json'), JSON.stringify(localCapability));
  await fs.writeFile(
    path.join(dir, 'official-usage-input.json'),
    JSON.stringify({
      projectAlias: config.projectAlias,
      remainingMinutes: 5000,
      remainingBytes: 10_000_000_000,
      checkedAtEpochMs: EPOCH,
      source: 'cloud-dashboard',
      checkedBy: 'synthetic-test-only',
    }),
  );
  const clock = { offset: 0 };
  const start = performance.now();
  const participants = new Map<string, { room: string; participant: ParticipantInfo }>();
  const rooms = new Map<string, Room>();
  const listRooms = vi.fn(async () => [...rooms.values()]);
  const listParticipants = vi.fn(async (room: string) =>
    [...participants.values()]
      .filter((value) => value.room === room)
      .map((value) => value.participant),
  );
  const getParticipant = vi.fn(async (room: string, identity: string) => {
    const value = participants.get(identity);
    if (!value || value.room !== room) throw { code: 'not_found', status: 404 };
    return value.participant;
  });
  const removeParticipant = vi.fn(async (_room: string, identity: string): Promise<void> => {
    participants.delete(identity);
  });
  const updateSubscriptions = vi.fn(async (): Promise<void> => {});
  const client: GatewayClient = {
    listRooms,
    listParticipants,
    getParticipant,
    removeParticipant,
    updateSubscriptions,
    createRoom: vi.fn(async (input) => {
      const room = new Room({ name: input.name });
      rooms.set(room.name, room);
      return room;
    }),
    deleteRoom: vi.fn(async (room) => {
      rooms.delete(room);
    }),
    updateParticipant: vi.fn(async () => new ParticipantInfo()),
  };
  const deps: MediaCoordinatorDeps = {
    config,
    monotonicNow: () => performance.now() - start + clock.offset,
    epochNowSeconds: () => (EPOCH + clock.offset) / 1000,
    emitMetric: vi.fn(),
    enqueueControl: vi.fn(),
    enqueueBindings: vi.fn(),
    enqueueAudioPolicy: vi.fn(),
    getGameActivity: () => ({ activeMatches: 0, activePractices: 0, pendingAdmissions: 0 }),
  };
  const services: MediaCoordinatorServices = {
    mediaMode: () => 'cloud',
    productSecurityReady: () => true,
    namespaceOwnershipConfirmed: () => true,
    firstInstallationConfirmed: async () => true,
    firstAuditConfirmed: () => true,
    getOfficialRevision: () => ({ periodId: 'synthetic-test-period', version: 1 }),
    clientFactory: () => client,
    ...override,
  };
  const coordinator = createMediaCoordinator(deps, services);
  const beforeClose: (() => void)[] = [];
  closers.push(async () => {
    for (const close of beforeClose) close();
    await coordinator.close();
  });
  const publish = (grant: MediaGrant, playerId: string) => {
    const participant = new ParticipantInfo({
      identity: grant.mediaIdentity,
      sid: `PA_${playerId}_${grant.receiverGeneration}`,
      tracks: [
        new TrackInfo({
          sid: `FACE_${playerId}_${grant.receiverGeneration}`,
          source: TrackSource.CAMERA,
          type: TrackType.VIDEO,
        }),
        new TrackInfo({
          sid: `AUDIO_${playerId}_${grant.receiverGeneration}`,
          source: TrackSource.MICROPHONE,
          type: TrackType.AUDIO,
        }),
      ],
    });
    participants.set(grant.mediaIdentity, { room: grant.roomName, participant });
    return participant;
  };
  return {
    dir,
    coordinator,
    deps,
    clock,
    participants,
    rooms,
    listRooms,
    listParticipants,
    getParticipant,
    removeParticipant,
    updateSubscriptions,
    publish,
    beforeClose,
    deleteRoom: vi.mocked(client.deleteRoom),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Ready = Extract<PreparationResult, { status: 'ready' }>;

async function ready(f: Fixture) {
  expect(await f.coordinator.initialize()).toMatchObject({
    status: 'initialized',
    admission: 'DRAINING',
  });
  await vi.waitFor(
    () =>
      expect(f.coordinator.getReadiness()).toEqual({
        state: 'READY',
        reasonCodes: [],
        historyComplete: true,
        unresolvedCount: 0,
      }),
    { timeout: 3000, interval: 10 },
  );
}
async function open(f: Fixture) {
  await ready(f);
  const operations = f.coordinator.getOperations();
  expect(operations.submit({ requestId: 'open-fixture', action: 'resume' }).status).toBe(
    'accepted',
  );
  await vi.waitFor(() => expect(operations.getSnapshot('open-fixture')?.status).toBe('succeeded'), {
    timeout: 3000,
    interval: 10,
  });
  expect(f.coordinator.canIssue()).toBe(true);
}
function game(players = 1, patch: Partial<TrustedMediaFrame> = {}): TrustedMediaFrame {
  return {
    ...practiceFrame,
    mediaInstanceId: 'game',
    instancePurpose: 'game',
    phase: 'PLAYING',
    topology: {
      topologyVersion: 'game-fixture',
      width: 6,
      height: 1,
      walkable: [true, true, true, true, true, true],
    },
    participants: Array.from({ length: players }, (_, i) => ({
      ...practiceFrame.participants[0]!,
      playerId: `p${i + 1}`,
      cell: { x: i, y: 0 },
    })),
    ...patch,
  };
}
function request(
  playerId = 'p1',
  patch: Partial<PrepareGenerationRequest> = {},
): PrepareGenerationRequest {
  return {
    ...prepareRequest,
    requestId: `prepare-${playerId}`,
    playerId,
    mediaInstanceId: 'game',
    purpose: 'game',
    ...patch,
  };
}
function alive(f: Fixture, current: TrustedMediaFrame) {
  f.coordinator.observeFrame(current);
  for (const player of current.participants)
    f.coordinator.lifecycle.setGameConnection({
      matchId: current.matchId,
      playerId: player.playerId,
      connected: true,
    });
}
async function prepare(f: Fixture, input = request()): Promise<Ready> {
  const value = await f.coordinator.prepareGeneration(input);
  expect(value).toMatchObject({ status: 'ready', code: null });
  if (value.status !== 'ready') throw new Error('FIXTURE_PREPARATION_FAILED');
  return value;
}
function localClosed(f: Fixture, generation: Ready): boolean {
  return f.coordinator.lifecycle.report({
    matchId: generation.matchId,
    playerId: generation.playerId,
    mediaInstanceId: generation.mediaInstanceId,
    receiverGeneration: generation.receiverGeneration,
    status: 'closed',
  });
}
async function flush() {
  for (let count = 0; count < 60; count++) await Promise.resolve();
}

async function operationsHttp(f: Fixture) {
  const handlers = f.coordinator.createOperationsHandlers(
    (authorization) => authorization === 'Bearer synthetic-ops-test',
  );
  const app = express();
  app.post('/ops/commands', express.json(), handlers.command);
  app.get('/ops/commands/:requestId', handlers.snapshot);
  app.get('/ops/status', handlers.status);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address() as AddressInfo;
  return (route: string, authorization?: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(authorization ? { authorization } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

describe('E-16 actual coordinator factory with real local disk and synthetic Cloud transport', () => {
  it('never treats an uncertain reservation exception as a safe unissued cancellation', async () => {
    const sign = vi.fn(async () => 'synthetic-test-token');
    const f = await fixture({ sign });
    await open(f);
    alive(f, game());
    const reservation = vi
      .spyOn(UsageBudget.prototype, 'reserve')
      .mockRejectedValueOnce(new Error('synthetic-checkpoint-error'));
    expect(await f.coordinator.prepareGeneration(request())).toMatchObject({
      status: 'unknown',
      code: 'REMOTE_UNAVAILABLE',
    });
    reservation.mockRestore();
    alive(f, game(1, { matchId: 'next-match' }));
    expect(
      await f.coordinator.prepareGeneration(
        request('p1', { requestId: 'after-unknown', matchId: 'next-match' }),
      ),
    ).toMatchObject({ status: 'rejected' });
    expect(sign).not.toHaveBeenCalled();
    expect(f.coordinator.canIssue()).toBe(false);
  });

  it('does not restart the 10s window between old local/remote retirement and a replacement request', async () => {
    const sign = vi.fn(async () => 'synthetic-test-token');
    const f = await fixture({ sign });
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, 'p1');
    await f.coordinator.reconcile();
    expect(
      f.coordinator.lifecycle.report({
        matchId: first.matchId,
        playerId: first.playerId,
        mediaInstanceId: first.mediaInstanceId,
        receiverGeneration: first.receiverGeneration,
        status: 'recovering',
      }),
    ).toBe(true);
    f.clock.offset = 9000;
    localClosed(f, first);
    expect(
      await f.coordinator.retireGeneration({
        requestId: 'old-before-replacement',
        matchId: first.matchId,
        playerId: first.playerId,
        mediaInstanceId: first.mediaInstanceId,
        receiverGeneration: first.receiverGeneration,
        reason: 'reconnect',
      }),
    ).toMatchObject({ status: 'confirmed' });
    f.clock.offset = 10_100;
    expect(
      await f.coordinator.prepareGeneration(
        request('p1', { requestId: 'too-late-replacement', expectedPreviousGeneration: 1 }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'TIMEOUT' });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(f.deps.enqueueControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MEDIA_FAILED', code: 'TIMEOUT' }),
    );
  });

  it('retires existing Cloud identities when product readiness disappears', async () => {
    let securityReady = true;
    const f = await fixture({ productSecurityReady: () => securityReady });
    await open(f);
    alive(f, game(2));
    const first = await prepare(f, request('p1'));
    const second = await prepare(f, request('p2'));
    f.publish(first.grant, 'p1');
    f.publish(second.grant, 'p2');
    await f.coordinator.reconcile();
    await flush();
    expect(f.updateSubscriptions.mock.calls.length).toBeGreaterThan(0);
    securityReady = false;
    await f.coordinator.reconcile();
    await vi.waitFor(() => expect(f.removeParticipant).toHaveBeenCalledTimes(2));
    securityReady = true;
    const calls = f.updateSubscriptions.mock.calls.length;
    await f.coordinator.reconcile();
    expect(f.updateSubscriptions).toHaveBeenCalledTimes(calls);
    expect(f.coordinator.canIssue()).toBe(false);
    expect(f.deps.enqueueControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MEDIA_FAILED', code: 'POLICY_UNKNOWN' }),
    );
  });

  it.each([false, true])(
    'allows admission after a definitive unissued budget rejection, next match=%s',
    async (nextMatch) => {
      const f = await fixture();
      await open(f);
      alive(f, game());
      const reservation = vi
        .spyOn(UsageBudget.prototype, 'reserve')
        .mockResolvedValueOnce({ status: 'rejected', code: 'MINUTES_EXHAUSTED' });
      const first = await f.coordinator.prepareGeneration(request());
      expect(first).toMatchObject({
        status: 'rejected',
        code: 'BUDGET_EXHAUSTED',
        grant: null,
        receiverGeneration: 1,
      });
      reservation.mockRestore();
      const matchId = nextMatch ? 'next-match' : 'm';
      if (nextMatch) alive(f, game(1, { matchId }));
      const second = await f.coordinator.prepareGeneration(
        request('p1', {
          requestId: 'retry-admission',
          matchId,
          expectedPreviousGeneration: nextMatch ? null : 1,
        }),
      );
      expect(second).toMatchObject({ status: 'ready', receiverGeneration: nextMatch ? 1 : 2 });
      expect(f.removeParticipant).not.toHaveBeenCalled();
    },
  );

  it('reclaims no participant capacity for an unissued attempt and still cleans the issued room', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    for (let attempt = 0; attempt < f.deps.config.maxConcurrentParticipants + 1; attempt++) {
      const reservation = vi
        .spyOn(UsageBudget.prototype, 'reserve')
        .mockResolvedValueOnce({ status: 'rejected', code: 'MINUTES_EXHAUSTED' });
      expect(
        await f.coordinator.prepareGeneration(
          request('p1', {
            requestId: `rejected-${attempt}`,
            expectedPreviousGeneration: attempt || null,
          }),
        ),
      ).toMatchObject({ code: 'BUDGET_EXHAUSTED' });
      reservation.mockRestore();
    }
    const grant = await prepare(
      f,
      request('p1', {
        requestId: 'accepted-after-rejections',
        expectedPreviousGeneration: f.deps.config.maxConcurrentParticipants + 1,
      }),
    );
    f.rooms.set(grant.grant.roomName, new Room({ name: grant.grant.roomName }));
    localClosed(f, grant);
    expect(
      await f.coordinator.retireGeneration({
        matchId: grant.matchId,
        playerId: grant.playerId,
        mediaInstanceId: grant.mediaInstanceId,
        receiverGeneration: grant.receiverGeneration,
        requestId: 'retire-issued',
        reason: 'round-ended',
      }),
    ).toMatchObject({ status: 'confirmed' });
    await vi.waitFor(() => expect(f.deleteRoom).toHaveBeenCalledWith(grant.grant.roomName));
    expect(f.removeParticipant).toHaveBeenCalledTimes(1);
  });

  it('initializes E-12/E-13 and exposes READY/DRAINING until an explicit durable operator resume', async () => {
    const f = await fixture();
    expect(f.coordinator.isInitialized()).toBe(false);
    await ready(f);
    expect(f.listRooms).toHaveBeenCalled();
    expect(f.coordinator.getOperations().getStatus()).toMatchObject({
      readiness: 'READY',
      admission: 'DRAINING',
    });
    expect(await f.coordinator.prepareGeneration(request())).toMatchObject({
      status: 'rejected',
      code: 'NOT_READY',
    });
    expect(
      f.coordinator.getOperations().submit({ requestId: 'resume', action: 'resume' }).status,
    ).toBe('accepted');
    await vi.waitFor(() =>
      expect(f.coordinator.getOperations().getSnapshot('resume')?.status).toBe('succeeded'),
    );
    expect(f.coordinator.canIssue()).toBe(true);
    const audit = await fs.readFile(path.join(f.dir, 'operations-audit.json'), 'utf8');
    expect(audit).toContain('succeeded');
  });

  it('requires the actual player game connection, then uses E-05 to persist and sign a restricted JWT', async () => {
    const f = await fixture();
    await open(f);
    f.coordinator.observeFrame(game());
    expect(await f.coordinator.prepareGeneration(request())).toMatchObject({ status: 'rejected' });
    expect(
      vi
        .mocked(f.deps.enqueueControl)
        .mock.calls.some(
          ([event]) => event.type === 'MEDIA_PREPARED' && event.result.status === 'ready',
        ),
    ).toBe(false);
    f.coordinator.lifecycle.setGameConnection({ matchId: 'm', playerId: 'p1', connected: true });
    const issued = await prepare(f, request('p1', { requestId: 'connected-prepare' }));
    const payload = JSON.parse(
      Buffer.from(issued.grant.token.split('.')[1]!, 'base64url').toString('utf8'),
    );
    expect(payload).toMatchObject({
      sub: issued.grant.mediaIdentity,
      exp: issued.grant.expiresAt,
      video: {
        room: issued.grant.roomName,
        roomJoin: true,
        canSubscribe: false,
        canPublishData: false,
        canPublishSources: ['camera', 'microphone'],
      },
    });
    expect(f.deps.enqueueControl).toHaveBeenCalledWith({ type: 'MEDIA_PREPARED', result: issued });
    f.publish(issued.grant, issued.playerId);
    await f.coordinator.reconcile();
    expect(f.deps.enqueueBindings).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        receiverGeneration: 1,
        participants: [expect.objectContaining({ playerId: 'p1', faceTrackSid: 'FACE_p1_1' })],
      }),
    );
  });

  it('waits for both remote remove ACK plus absence and D local closure before replacement while keeping OPEN', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    await f.coordinator.reconcile();
    const ack = deferred<void>();
    f.beforeClose.push(() => ack.resolve());
    f.removeParticipant.mockImplementationOnce(async (_room, identity) => {
      await ack.promise;
      f.participants.delete(identity);
    });
    let settled = false;
    const next = f.coordinator
      .prepareGeneration(request('p1', { requestId: 'replace', expectedPreviousGeneration: 1 }))
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.waitFor(() => expect(f.removeParticipant).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(f.coordinator.getOperations().getStatus()).toMatchObject({
      readiness: 'READY',
      admission: 'OPEN',
    });
    expect(localClosed(f, first)).toBe(true);
    await flush();
    expect(settled).toBe(false);
    ack.resolve();
    const second = await next;
    expect(second).toMatchObject({ status: 'ready', receiverGeneration: 2 });
    if (second.status === 'ready')
      expect(second.grant.mediaIdentity).not.toBe(first.grant.mediaIdentity);
    expect(f.listParticipants).toHaveBeenCalledWith(first.grant.roomName);
    expect(f.coordinator.getOperations().getStatus()).toMatchObject({
      readiness: 'READY',
      admission: 'OPEN',
    });
  });

  it('remote confirmation alone never replaces D local retirement acknowledgement', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    let settled = false;
    const next = f.coordinator
      .prepareGeneration(
        request('p1', { requestId: 'waiting-local', expectedPreviousGeneration: 1 }),
      )
      .then((value) => {
        settled = true;
        return value;
      });
    await vi.waitFor(() =>
      expect(f.deps.enqueueControl).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MEDIA_RETIRED',
          result: expect.objectContaining({ status: 'confirmed' }),
        }),
      ),
    );
    expect(settled).toBe(false);
    expect(f.coordinator.getOperations().getStatus().admission).toBe('OPEN');
    expect(
      f.coordinator.lifecycle.report({
        matchId: 'm',
        playerId: 'p1',
        mediaInstanceId: 'game',
        receiverGeneration: 99,
        status: 'closed',
      }),
    ).toBe(false);
    await flush();
    expect(settled).toBe(false);
    expect(localClosed(f, first)).toBe(true);
    expect(await next).toMatchObject({ status: 'ready', receiverGeneration: 2 });
  });

  it('replaces one of six actual grants without changing the other five receiver generations', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game(6));
    const first = [];
    for (let i = 1; i <= 6; i++) {
      const value = await prepare(f, request(`p${i}`));
      first.push(value);
      f.publish(value.grant, value.playerId);
    }
    await f.coordinator.reconcile();
    await flush();
    expect(localClosed(f, first[1]!)).toBe(true);
    const replaced = await prepare(
      f,
      request('p2', { requestId: 'p2-replace', expectedPreviousGeneration: 1 }),
    );
    f.publish(replaced.grant, replaced.playerId);
    await f.coordinator.reconcile();
    await flush();
    const bindings = vi.mocked(f.deps.enqueueBindings).mock.calls;
    for (const old of first.filter((value) => value.playerId !== 'p2')) {
      const current = bindings.filter(([id]) => id === old.playerId).at(-1)![1];
      expect(current.receiverGeneration).toBe(old.receiverGeneration);
      expect(current.participants.find((value) => value.playerId === 'p2')).toMatchObject({
        publisherGeneration: 2,
        mediaIdentity: replaced.grant.mediaIdentity,
      });
    }
    expect(f.removeParticipant).toHaveBeenCalledTimes(1);
    expect(f.coordinator.getOperations().getStatus().admission).toBe('OPEN');
  });

  it('blocks a new JWT when remote retirement is UNKNOWN even with D local closed', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    expect(localClosed(f, first)).toBe(true);
    f.removeParticipant.mockRejectedValueOnce({ code: 'unavailable', status: 503 });
    const result = await f.coordinator.prepareGeneration(
      request('p1', { requestId: 'unknown-replace', expectedPreviousGeneration: 1 }),
    );
    expect(result).toMatchObject({
      status: 'unknown',
      grant: null,
      code: 'RETIREMENT_UNCONFIRMED',
    });
    expect(
      vi
        .mocked(f.deps.enqueueControl)
        .mock.calls.filter(
          ([event]) => event.type === 'MEDIA_PREPARED' && event.result.status === 'ready',
        ),
    ).toHaveLength(1);
    expect(f.coordinator.canIssue()).toBe(false);
    expect(f.coordinator.getOperations().getStatus().admission).not.toBe('OPEN');
  });

  it('keeps the same player in a new match blocked until the previous match is remotely and locally retired', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    alive(f, game(1, { matchId: 'next-match' }));
    const nextRequest = request('p1', { matchId: 'next-match', requestId: 'next-round' });
    expect(await f.coordinator.prepareGeneration(nextRequest)).toMatchObject({
      status: 'rejected',
    });
    expect(
      await f.coordinator.retireGeneration({
        requestId: 'end-old',
        matchId: first.matchId,
        playerId: first.playerId,
        mediaInstanceId: first.mediaInstanceId,
        receiverGeneration: first.receiverGeneration,
        reason: 'round-ended',
      }),
    ).toMatchObject({ status: 'confirmed' });
    expect(
      await f.coordinator.prepareGeneration({ ...nextRequest, requestId: 'remote-only' }),
    ).toMatchObject({ status: 'rejected' });
    expect(localClosed(f, first)).toBe(true);
    expect(
      await f.coordinator.prepareGeneration({ ...nextRequest, requestId: 'fully-retired' }),
    ).toMatchObject({ status: 'ready', receiverGeneration: 1 });
  });

  it.each(['RESULT', 'CAPTURED'] as const)(
    'ignores an obsolete practice %s frame after the same-match game transition',
    async (staleKind) => {
      const f = await fixture();
      await open(f);
      const practice = {
        ...practiceFrame,
        participants: [{ ...practiceFrame.participants[0]!, playerId: 'p1' }],
      };
      alive(f, practice);
      const previous = await prepare(
        f,
        request('p1', {
          requestId: 'practice-first',
          mediaInstanceId: 'practice',
          purpose: 'practice',
        }),
      );
      f.publish(previous.grant, previous.playerId);
      alive(f, game());
      expect(localClosed(f, previous)).toBe(true);
      const current = await prepare(
        f,
        request('p1', { requestId: 'game-second', expectedPreviousGeneration: 1 }),
      );
      f.publish(current.grant, current.playerId);
      await f.coordinator.reconcile();
      f.coordinator.observeFrame({
        ...practice,
        frameRevision: 2,
        phase: staleKind === 'RESULT' ? 'RESULT' : 'TEAM_PRACTICE',
        participants: practice.participants.map((participant) => ({
          ...participant,
          status: staleKind === 'CAPTURED' ? 'CAPTURED' : 'ACTIVE',
        })),
      });
      await flush();
      expect(
        f.removeParticipant.mock.calls.some(
          ([, identity]) => identity === current.grant.mediaIdentity,
        ),
      ).toBe(false);
      expect(
        await f.coordinator.prepareGeneration(
          request('p1', { requestId: 'game-second', expectedPreviousGeneration: 1 }),
        ),
      ).toMatchObject({ status: 'ready', receiverGeneration: 2 });
    },
  );

  it('retires a current generation when the next authoritative frame omits its participant', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    f.coordinator.observeFrame(game(0, { frameRevision: 2 }));
    await vi.waitFor(() =>
      expect(
        f.removeParticipant.mock.calls.some(
          ([, identity]) => identity === first.grant.mediaIdentity,
        ),
      ).toBe(true),
    );
    expect(
      await f.coordinator.prepareGeneration(
        request('p1', { requestId: 'omitted-reprepare', expectedPreviousGeneration: 1 }),
      ),
    ).toMatchObject({ status: 'rejected' });
  });

  it.each(['throw', 'close'] as const)(
    'does not return a ready HTTP grant if policy registration callbacks %s',
    async (mode) => {
      const f = await fixture();
      await open(f);
      alive(f, game());
      let closing: Promise<void> | undefined;
      vi.mocked(f.deps.enqueueBindings).mockImplementationOnce(() => {
        if (mode === 'throw') throw new Error('synthetic binding queue unavailable');
        closing = f.coordinator.close();
      });
      const result = await f.coordinator.prepareGeneration(request());
      expect(result.status).not.toBe('ready');
      expect(result.grant).toBeNull();
      if (closing) await closing;
    },
  );

  it('refuses a seventh concurrent participant at the configured six-participant cap', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game(7));
    for (let i = 1; i <= 6; i++) await prepare(f, request(`p${i}`));
    const seventh = await f.coordinator.prepareGeneration(request('p7'));
    expect(seventh.status).not.toBe('ready');
    expect(seventh.grant).toBeNull();
    expect(
      vi
        .mocked(f.deps.enqueueControl)
        .mock.calls.filter(
          ([event]) => event.type === 'MEDIA_PREPARED' && event.result.status === 'ready',
        ),
    ).toHaveLength(6);
  });

  it('retains a connected verified participant with renewed usage after join JWT expiry, while rejecting its expired cached grant', async () => {
    const f = await fixture();
    await open(f);
    const practice = {
      ...practiceFrame,
      participants: [{ ...practiceFrame.participants[0]!, playerId: 'p1' }],
    };
    alive(f, practice);
    const input = request('p1', {
      requestId: 'long-practice',
      mediaInstanceId: 'practice',
      purpose: 'practice',
    });
    const initial = await prepare(f, input);
    f.publish(initial.grant, initial.playerId);
    await f.coordinator.reconcile();
    // The active lease is renewed before its five-minute window runs out.
    f.clock.offset = 240_001;
    await f.coordinator.reconcile();
    expect(f.coordinator.getReadiness().state).toBe('READY');
    f.clock.offset = 300_001;
    await f.coordinator.reconcile();
    await flush();
    expect(f.removeParticipant).not.toHaveBeenCalled();
    expect(
      vi.mocked(f.deps.enqueueControl).mock.calls.some(([event]) => event.type === 'MEDIA_FAILED'),
    ).toBe(false);
    expect(f.coordinator.getReadiness().state).toBe('READY');
    expect(await f.coordinator.prepareGeneration(input)).toMatchObject({
      status: 'rejected',
      grant: null,
    });
  });

  it('never releases a ready grant or accepts late journal writes when close finishes before JWT signing', async () => {
    const signing = deferred<string>();
    const sign = vi.fn(() => signing.promise);
    const f = await fixture({ sign });
    await open(f);
    alive(f, game());
    f.beforeClose.push(() => signing.resolve('synthetic-closed-never-delivered'));
    const preparing = f.coordinator.prepareGeneration(request());
    await vi.waitFor(() => expect(sign).toHaveBeenCalledOnce());
    await f.coordinator.close();
    const before = await fs.readFile(path.join(f.dir, 'media-journal.jsonl'), 'utf8');
    signing.resolve('synthetic-closed-never-delivered');
    expect(await preparing).toMatchObject({ status: 'rejected', grant: null });
    await flush();
    expect(await fs.readFile(path.join(f.dir, 'media-journal.jsonl'), 'utf8')).toBe(before);
    expect(
      vi
        .mocked(f.deps.enqueueControl)
        .mock.calls.some(
          ([event]) => event.type === 'MEDIA_PREPARED' && event.result.status === 'ready',
        ),
    ).toBe(false);
    expect(f.coordinator.canIssue()).toBe(false);
  });

  it('emits media failure and retires the affected generation when an active usage renewal throws', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    await f.coordinator.reconcile();
    vi.spyOn(UsageBudget.prototype, 'reserve').mockRejectedValueOnce(
      new Error('synthetic renewal failure'),
    );
    f.clock.offset = 240_001;
    await f.coordinator.reconcile();
    expect(f.deps.enqueueControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MEDIA_FAILED', playerId: 'p1', receiverGeneration: 1 }),
    );
    await vi.waitFor(() =>
      expect(
        f.removeParticipant.mock.calls.some(
          ([, identity]) => identity === first.grant.mediaIdentity,
        ),
      ).toBe(true),
    );
    expect(f.coordinator.canIssue()).toBe(false);
  });

  it.each(['disabled', 'mock', null] as const)(
    'never opens the product gate for media mode %s despite valid synthetic Cloud evidence',
    async (mode) => {
      const f = await fixture({ mediaMode: () => mode });
      expect(await f.coordinator.initialize()).toMatchObject({
        status: 'initialized',
        admission: 'DRAINING',
      });
      expect(f.coordinator.getReadiness().state).toBe('LOCKED');
      alive(f, game());
      expect(await f.coordinator.prepareGeneration(request())).toMatchObject({
        status: 'rejected',
        code: 'NOT_READY',
        grant: null,
      });
      expect(f.coordinator.canIssue()).toBe(false);
    },
  );

  it('shares concurrent remote retirement work while emitting each B request id result exactly once', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    const ack = deferred<void>();
    f.beforeClose.push(() => ack.resolve());
    f.removeParticipant.mockImplementationOnce(async (_room, identity) => {
      await ack.promise;
      f.participants.delete(identity);
    });
    const base = {
      matchId: first.matchId,
      playerId: first.playerId,
      mediaInstanceId: first.mediaInstanceId,
      receiverGeneration: first.receiverGeneration,
      reason: 'round-ended' as const,
    };
    const requestA = { ...base, requestId: 'retire-A' };
    const requestB = { ...base, requestId: 'retire-B' };
    const resultA = f.coordinator.retireGeneration(requestA);
    const resultB = f.coordinator.retireGeneration(requestB);
    await vi.waitFor(() => expect(f.removeParticipant).toHaveBeenCalledOnce());
    ack.resolve();
    expect(await resultA).toMatchObject({ requestId: 'retire-A', status: 'confirmed', code: null });
    expect(await resultB).toMatchObject({ requestId: 'retire-B', status: 'confirmed', code: null });
    await f.coordinator.retireGeneration(requestA);
    const results = vi
      .mocked(f.deps.enqueueControl)
      .mock.calls.flatMap(([event]) => (event.type === 'MEDIA_RETIRED' ? [event.result] : []));
    expect(results.filter((value) => value.requestId === 'retire-A')).toHaveLength(1);
    expect(results.filter((value) => value.requestId === 'retire-B')).toHaveLength(1);
    expect(f.removeParticipant).toHaveBeenCalledOnce();
  });

  it('keeps a room for its five remaining participants and deletes it only after the last identity is remotely confirmed', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game(6));
    const issued: Ready[] = [];
    for (let i = 1; i <= 6; i++) {
      const value = await prepare(f, request(`p${i}`));
      issued.push(value);
      f.publish(value.grant, value.playerId);
    }
    const roomName = issued[0]!.grant.roomName;
    f.rooms.set(roomName, new Room({ name: roomName }));
    const retire = (value: Ready) =>
      f.coordinator.retireGeneration({
        requestId: `room-end-${value.playerId}`,
        matchId: value.matchId,
        playerId: value.playerId,
        mediaInstanceId: value.mediaInstanceId,
        receiverGeneration: value.receiverGeneration,
        reason: 'round-ended',
      });
    expect(await retire(issued[0]!)).toMatchObject({ status: 'confirmed' });
    expect(f.deleteRoom).not.toHaveBeenCalled();
    expect(f.rooms.has(roomName)).toBe(true);
    for (const value of issued.slice(1))
      expect(await retire(value)).toMatchObject({ status: 'confirmed' });
    expect(f.removeParticipant).toHaveBeenCalledTimes(6);
    expect(f.deleteRoom).toHaveBeenCalledExactlyOnceWith(roomName);
    expect(f.rooms.has(roomName)).toBe(false);
    expect(f.listRooms.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(
      f.deleteRoom.mock.invocationCallOrder[0]!,
    );
  });

  it('binds authenticated operations HTTP to the factory audit without overwriting command or failed-auth history', async () => {
    const f = await fixture();
    await ready(f);
    const requestHttp = await operationsHttp(f);
    const unauthorized = await requestHttp('/ops/status');
    expect(unauthorized.status).toBe(403);
    expect(unauthorized.headers.get('cache-control')).toBe('no-store');
    expect(await unauthorized.json()).toEqual({ code: 'UNAUTHORIZED' });
    const accepted = await requestHttp('/ops/commands', 'Bearer synthetic-ops-test', {
      requestId: 'http-resume',
      action: 'resume',
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ requestId: 'http-resume' });
    await vi.waitFor(() =>
      expect(f.coordinator.getOperations().getSnapshot('http-resume')?.status).toBe('succeeded'),
    );
    const snapshot = await requestHttp('/ops/commands/http-resume', 'Bearer synthetic-ops-test');
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ requestId: 'http-resume', status: 'succeeded' });
    const rejected = await requestHttp('/ops/commands', 'Bearer attacker-value', {
      requestId: 'attacker-request',
      action: 'drain',
    });
    expect(rejected.status).toBe(403);
    await rejected.json();
    const text = await fs.readFile(path.join(f.dir, 'operations-audit.json'), 'utf8');
    const audit = JSON.parse(text);
    expect(audit.state.entries).toHaveLength(1);
    expect(audit.state.entries[0]).toMatchObject({
      snapshot: { requestId: 'http-resume', action: 'resume', status: 'succeeded' },
    });
    expect(audit.state.events).toHaveLength(2);
    expect(audit.state.events).toEqual([
      expect.objectContaining({ kind: 'auth-failed', resultCode: 'UNAUTHORIZED', requestId: null }),
      expect.objectContaining({ kind: 'auth-failed', resultCode: 'UNAUTHORIZED', requestId: null }),
    ]);
    expect(text).not.toContain('attacker-value');
    expect(text).not.toContain('attacker-request');
    expect(f.coordinator.canIssue()).toBe(true);
  });

  it('locks the same product runtime when an operations HTTP auth rejection cannot reach its audit', async () => {
    const f = await fixture();
    await open(f);
    const requestHttp = await operationsHttp(f);
    const recordEvent = vi
      .spyOn(OperationsAudit.prototype, 'recordEvent')
      .mockRejectedValueOnce(new Error('synthetic audit write failure'));
    const response = await requestHttp('/ops/status');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
      kind: 'auth-failed',
      code: 'UNAUTHORIZED',
    });
    expect(f.coordinator.getReadiness().state).toBe('LOCKED');
    expect(f.coordinator.canIssue()).toBe(false);
    expect(f.coordinator.getOperations().getStatus().admission).not.toBe('OPEN');
  });

  it('requires durable REVOKED evidence before the same player enters a new match despite remote and local acknowledgements', async () => {
    const f = await fixture();
    await open(f);
    alive(f, game());
    const first = await prepare(f);
    f.publish(first.grant, first.playerId);
    expect(localClosed(f, first)).toBe(true);
    alive(f, game(1, { matchId: 'next-match' }));
    const writingRevoked = deferred<void>();
    const releaseRevoked = deferred<void>();
    f.beforeClose.push(() => releaseRevoked.resolve());
    const append = OperationJournal.prototype.append;
    let held = false;
    vi.spyOn(OperationJournal.prototype, 'append').mockImplementation(async function (
      this: OperationJournal,
      input,
    ) {
      if (!held && input.identity === first.grant.mediaIdentity && input.state === 'REVOKED') {
        held = true;
        writingRevoked.resolve();
        await releaseRevoked.promise;
      }
      return append.call(this, input);
    });
    const retirement = f.coordinator.retireGeneration({
      requestId: 'retire-before-next',
      matchId: first.matchId,
      playerId: first.playerId,
      mediaInstanceId: first.mediaInstanceId,
      receiverGeneration: first.receiverGeneration,
      reason: 'round-ended',
    });
    await writingRevoked.promise;
    expect(f.removeParticipant).toHaveBeenCalledOnce();
    expect(f.listParticipants).toHaveBeenCalledWith(first.grant.roomName);
    expect(f.coordinator.getOperations().getStatus()).toMatchObject({
      readiness: 'READY',
      admission: 'OPEN',
    });
    expect(
      await f.coordinator.prepareGeneration(
        request('p1', { matchId: 'next-match', requestId: 'memory-only-next' }),
      ),
    ).toMatchObject({ status: 'rejected', grant: null });
    releaseRevoked.resolve();
    expect(await retirement).toMatchObject({ status: 'confirmed' });
    expect(
      await f.coordinator.prepareGeneration(
        request('p1', { matchId: 'next-match', requestId: 'durable-next' }),
      ),
    ).toMatchObject({ status: 'ready', receiverGeneration: 1 });
  });
});
