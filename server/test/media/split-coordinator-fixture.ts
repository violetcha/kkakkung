import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  AccessToken,
  ParticipantInfo,
  Room,
  TrackInfo,
  TrackSource,
  TrackType,
} from 'livekit-server-sdk';
import { expect, vi } from 'vitest';
import { createMediaCoordinator } from '../../src/media/MediaCoordinator.js';
import type { GatewayClient } from '../../src/media/LiveKitGateway.js';
import type { MediaCoordinatorDeps, MediaGrant, PreparationResult } from '../../src/media/types.js';
import { localConfiguration, prepareRequest } from './generation-fixtures.js';
import { localSplitCapability, splitPracticeFrame } from './split-fixtures.js';

/** Actual product coordinator, JWTs and files; only the Cloud transport and authenticated owner
 * evidence are synthetic. The public environment parser remains closed outside this fixture.
 */
export async function splitCoordinatorFixture(capacity = 100, count = 2) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-split-factory-'));
  const epoch = 1_800_000_000_000;
  const start = performance.now();
  const clock = { offset: 0 };
  const config = {
    ...localConfiguration(epoch),
    opsDataDir: directory,
    subscriptionMode: 'server-forwarding' as const,
    operatingMode: 'continuous' as const,
    maxConcurrentParticipants: capacity,
  };
  await fs.writeFile(
    path.join(directory, 'capability-report.json'),
    JSON.stringify(localSplitCapability(epoch)),
  );
  const remote = new Map<string, ParticipantInfo>();
  const rooms = new Map<string, Room>();
  const calls: string[] = [];
  let cloneVersion = 0;
  const key = (room: string, identity: string) => `${room}/${identity}`;
  const get = vi.fn(async (room: string, identity: string) => {
    const participant = remote.get(key(room, identity));
    if (!participant) throw { code: 'not_found', status: 404 };
    return participant;
  });
  const forward = vi.fn(async (room: string, identity: string, destination: string) => {
    calls.push('forward');
    const origin = await get(room, identity);
    cloneVersion++;
    const clone = new ParticipantInfo({
      identity,
      sid: `CLONE_PARTICIPANT_${cloneVersion}`,
      tracks: origin.tracks.map(
        (track) => new TrackInfo({ ...track, sid: `CLONE_TRACK_${cloneVersion}` }),
      ),
    });
    remote.set(key(destination, identity), clone);
    return clone;
  });
  const remove = vi.fn(async (room: string, identity: string) => {
    calls.push('remove');
    remote.delete(key(room, identity));
  });
  const removeRoom = vi.fn(async (room: string) => {
    rooms.delete(room);
    for (const id of remote.keys()) if (id.startsWith(`${room}/`)) remote.delete(id);
  });
  const subscriptions = vi.fn(async () => {});
  const client: GatewayClient = {
    getParticipant: get,
    forwardParticipant: forward,
    removeParticipant: remove,
    listRooms: async (names) =>
      [...rooms.values()].filter((room) => !names || names.includes(room.name)),
    listParticipants: async (room) =>
      [...remote].filter(([id]) => id.startsWith(`${room}/`)).map(([, value]) => value),
    createRoom: async (input) => {
      const room = new Room({ name: input.name });
      rooms.set(room.name, room);
      return room;
    },
    deleteRoom: removeRoom,
    updateParticipant: async () => new ParticipantInfo(),
    updateSubscriptions: subscriptions,
  };
  const deps: MediaCoordinatorDeps = {
    config,
    monotonicNow: () => performance.now() - start + clock.offset,
    epochNowSeconds: () => (epoch + clock.offset) / 1000,
    emitMetric: vi.fn(),
    enqueueControl: vi.fn(),
    enqueueBindings: vi.fn(),
    enqueueAudioPolicy: vi.fn(),
    getGameActivity: () => ({ activeMatches: 0, activePractices: 0, pendingAdmissions: 0 }),
  };
  const coordinator = createMediaCoordinator(deps, {
    mediaMode: () => 'cloud',
    productSecurityReady: () => true,
    namespaceOwnershipConfirmed: () => true,
    firstInstallationConfirmed: async () => true,
    firstAuditConfirmed: () => true,
    clientFactory: () => client,
  });
  const frame = {
    ...splitPracticeFrame,
    participants: splitPracticeFrame.participants.slice(0, count),
    topology: {
      topologyVersion: 'split-test',
      width: 8,
      height: 1,
      walkable: Array(8).fill(true) as boolean[],
    },
  };
  const request = (player = 0) => ({
    ...prepareRequest,
    requestId: `prepare-${player}`,
    playerId: `p${player}`,
  });
  const open = async () => {
    expect(await coordinator.initialize()).toMatchObject({ status: 'initialized' });
    await vi.waitFor(() => expect(coordinator.getReadiness().state).toBe('READY'), {
      timeout: 3000,
      interval: 10,
    });
    const operations = coordinator.getOperations();
    expect(operations.submit({ requestId: 'open-split', action: 'resume' }).status).toBe(
      'accepted',
    );
    await vi.waitFor(() => expect(operations.getSnapshot('open-split')?.status).toBe('succeeded'), {
      timeout: 3000,
      interval: 10,
    });
    for (const participant of frame.participants)
      coordinator.lifecycle.setGameConnection({
        matchId: frame.matchId,
        playerId: participant.playerId,
        connected: true,
      });
    coordinator.observeFrame(frame);
  };
  const publish = (grant: MediaGrant, faceOnly = false) => {
    const add = (roomName: string, identity: string, face: boolean) => {
      rooms.set(roomName, new Room({ name: roomName }));
      remote.set(
        key(roomName, identity),
        new ParticipantInfo({
          identity,
          sid: `ROOT_${identity}`,
          tracks: [
            new TrackInfo({
              sid: `TRACK_${identity}`,
              source: face ? TrackSource.CAMERA : TrackSource.MICROPHONE,
              type: face ? TrackType.VIDEO : TrackType.AUDIO,
            }),
          ],
        }),
      );
    };
    add(grant.facePublication!.roomName, grant.facePublication!.mediaIdentity, true);
    if (!faceOnly) add(grant.roomName, grant.mediaIdentity, false);
  };
  const prepare = async (player = 0) => {
    const result = await coordinator.prepareGeneration(request(player));
    expect(result.status).toBe('ready');
    return result as Extract<PreparationResult, { status: 'ready' }>;
  };
  const announce = async (grant: MediaGrant) => {
    for (const target of [grant, grant.facePublication!]) {
      const rawBody = JSON.stringify({
        event: 'participant_joined',
        id: randomUUID(),
        createdAt: '1',
        room: { name: target.roomName },
        participant: { identity: target.mediaIdentity },
      });
      const token = new AccessToken(config.apiKey, config.apiSecret, { ttl: 60 });
      token.sha256 = createHash('sha256').update(rawBody).digest('base64');
      await coordinator.handleWebhook(rawBody, await token.toJwt());
    }
  };
  const retire = (result: Extract<PreparationResult, { status: 'ready' }>) => {
    coordinator.lifecycle.report({ ...result, status: 'closed' });
    return coordinator.retireGeneration({
      ...request(),
      playerId: result.playerId,
      requestId: `retire-${result.playerId}-${result.receiverGeneration}`,
      receiverGeneration: result.receiverGeneration,
      reason: 'personal-ended',
    });
  };
  const close = async () => {
    await coordinator.close();
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith('kkakkung-split-factory-')
    )
      throw new Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(target, { recursive: true, force: true });
  };
  return {
    directory,
    coordinator,
    deps,
    clock,
    remote,
    rooms,
    calls,
    key,
    get,
    forward,
    remove,
    removeRoom,
    subscriptions,
    frame,
    request,
    open,
    publish,
    prepare,
    announce,
    retire,
    close,
  };
}
