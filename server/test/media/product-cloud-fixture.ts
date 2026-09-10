// Synthetic Cloud transport and evidence for local integration only. All E journal, budget,
// authorization, generation, policy and retirement implementations remain real.
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  AccessToken,
  ParticipantInfo,
  Room,
  TrackInfo,
  TrackSource,
  TrackType,
} from 'livekit-server-sdk';
import type { GatewayClient } from '../../src/media/LiveKitGateway.js';
import type { MediaCoordinatorServices } from '../../src/media/MediaCoordinator.js';
import type { MediaGrant } from '../../src/media/types.js';
import { localCapability, localConfiguration } from './generation-fixtures.js';
import { loadRuntimeEvidence, officialCheckpointDigest } from '../../src/config/RuntimeEvidence.js';

type PublicationTarget = Pick<MediaGrant, 'roomName' | 'mediaIdentity'>;

export async function productCloudFixture() {
  const epoch = Date.now();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-product-integration-'));
  const config = { ...localConfiguration(epoch), opsDataDir: directory };
  await fs.writeFile(
    path.join(directory, 'capability-report.json'),
    JSON.stringify({ ...localCapability, testedAtEpochMs: epoch }),
  );
  const checkpoint = {
    projectAlias: config.projectAlias,
    remainingMinutes: 5000,
    remainingBytes: 10_000_000_000,
    checkedAtEpochMs: epoch,
    source: 'cloud-dashboard' as const,
    checkedBy: 'synthetic-local-integration-only',
  };
  await fs.writeFile(path.join(directory, 'official-usage-input.json'), JSON.stringify(checkpoint));
  // Test evidence uses the actual F parser and one-use provisioning markers. These references
  // describe this synthetic fixture, not a real Cloud dashboard or approved deployment.
  await fs.writeFile(
    path.join(directory, 'runtime-evidence.json'),
    JSON.stringify({
      version: 1,
      attestationId: 'synthetic-local-integration',
      projectAlias: config.projectAlias,
      namespace: config.namespace,
      checkedBy: 'synthetic-local-integration-only',
      checkedAtEpochMs: epoch,
      expiresAtEpochMs: epoch + 600000,
      evidenceRefs: {
        namespaceOwnership: 'synthetic-isolated-fixture',
        firstInstallation: 'synthetic-new-temporary-directory',
        firstAudit: 'synthetic-new-audit-fixture',
      },
      officialBudget: {
        checkpointSha256: officialCheckpointDigest(checkpoint),
        periodId: 'synthetic-local-integration',
        version: 1,
        evidenceRef: 'synthetic-local-checkpoint-fixture',
      },
    }),
  );
  const evidence = await loadRuntimeEvidence({
    opsDataDir: directory,
    projectAlias: config.projectAlias,
    namespace: config.namespace,
    nowEpochMs: () => Date.now(),
    maxAgeMs: 3600000,
  });
  const rooms = new Map<string, Room>();
  const participants = new Map<string, { room: string; participant: ParticipantInfo }>();
  const removed: string[] = [];
  const subscriptions: unknown[] = [];
  const client: GatewayClient = {
    listRooms: async () => [...rooms.values()],
    createRoom: async (input) => {
      const room = new Room({ name: input.name });
      rooms.set(room.name, room);
      return room;
    },
    deleteRoom: async (room) => {
      rooms.delete(room);
    },
    listParticipants: async (room) =>
      [...participants.values()]
        .filter((value) => value.room === room)
        .map((value) => value.participant),
    getParticipant: async (room, identity) => {
      const current = participants.get(identity);
      if (!current || current.room !== room) throw { code: 'not_found', status: 404 };
      return current.participant;
    },
    removeParticipant: async (_room, identity) => {
      removed.push(identity);
      participants.delete(identity);
    },
    updateParticipant: async () => new ParticipantInfo(),
    updateSubscriptions: async (...input) => {
      subscriptions.push(input);
    },
  };
  const services: MediaCoordinatorServices = {
    ...evidence,
    mediaMode: () => 'cloud',
    productSecurityReady: () => true,
    clientFactory: () => client,
  };
  return {
    config,
    services,
    participants,
    removed,
    subscriptions,
    publish(grant: PublicationTarget) {
      const participant = new ParticipantInfo({
        identity: grant.mediaIdentity,
        sid: `PA_${grant.mediaIdentity}`,
        tracks: [
          new TrackInfo({
            sid: `FACE_${grant.mediaIdentity}`,
            source: TrackSource.CAMERA,
            type: TrackType.VIDEO,
          }),
          new TrackInfo({
            sid: `AUDIO_${grant.mediaIdentity}`,
            source: TrackSource.MICROPHONE,
            type: TrackType.AUDIO,
          }),
        ],
      });
      participants.set(grant.mediaIdentity, { room: grant.roomName, participant });
    },
    async publicationEvent(grant: PublicationTarget) {
      const rawBody = JSON.stringify({
        event: 'track_published',
        id: randomUUID(),
        createdAt: String(Math.floor(Date.now() / 1000)),
        room: { name: grant.roomName },
        participant: { identity: grant.mediaIdentity },
      });
      const token = new AccessToken(config.apiKey, config.apiSecret, { ttl: 60 });
      token.sha256 = createHash('sha256').update(rawBody).digest('base64');
      return { rawBody, authorization: await token.toJwt() };
    },
    async close() {
      await evidence.close();
      const target = path.resolve(directory);
      if (
        path.dirname(target) !== path.resolve(os.tmpdir()) ||
        !path.basename(target).startsWith('kkakkung-product-integration-')
      )
        throw new Error('UNSAFE_TEST_DIRECTORY');
      await fs.rm(target, { recursive: true, force: true });
    },
  };
}
