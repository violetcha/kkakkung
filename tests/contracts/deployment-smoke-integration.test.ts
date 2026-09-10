// Actual public A/B/C/E/F consumers. Transport counters below are fixtures, not Cloud RTP evidence.
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type {
  AudioPolicy,
  MediaBindings,
  MediaGrant,
} from '../../apps/web/src/features/input/InteractionRuntime';
import { startProductServerProcess } from '../../server/test/media/product-server-process.js';
import { runDeploymentSmoke } from '../cloud/DeploymentSmokeHarness.js';
import type { DeploymentMediaProbe } from '../cloud/DeploymentInteraction.js';
import { localDeploymentDevices, localDeploymentPlan } from '../fixtures/deployment-smoke-plan.js';

it('DP06 closes a partially joined game client and drains after browser initialization fails', async () => {
  const opsToken = randomUUID();
  const server = await startProductServerProcess(opsToken);
  try {
    await expect
      .poll(async () => (await server.inspect()).readiness?.state, { timeout: 5000 })
      .toBe('READY');
    const headers = { authorization: `Bearer ${opsToken}`, 'content-type': 'application/json' };
    const requestId = randomUUID();
    await fetch(server.endpoint + '/api/operations/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId, action: 'resume' }),
    });
    await expect
      .poll(
        async () =>
          (
            (await (
              await fetch(server.endpoint + `/api/operations/commands/${requestId}`, { headers })
            ).json()) as { status: string }
          ).status,
      )
      .toBe('succeeded');
    const report = await runDeploymentSmoke({
      mode: 'local-contract',
      baseUrl: server.endpoint,
      origin: 'http://localhost:5173',
      cookie: '',
      opsToken,
      preflight: localDeploymentPlan(),
      deviceManifest: localDeploymentDevices,
      async createProbe() {
        throw new Error('SYNTHETIC_BROWSER_INIT_FAILURE');
      },
    });
    expect(report).toMatchObject({
      status: 'FAIL',
      failureCode: 'DP06_SESSION_OR_JOIN_FAILED',
      participants: 0,
      cleanup: { drainConfirmed: true, resumed: false },
    });
    expect((await server.inspect()).participantCount).toBe(0);
  } finally {
    await server.close();
  }
}, 30_000);

it('DP06 local harness follows real six-client grant/phase/input/retirement APIs', async () => {
  const opsToken = randomUUID();
  const server = await startProductServerProcess(opsToken);
  try {
    await expect
      .poll(async () => (await server.inspect()).readiness?.state, { timeout: 5000 })
      .toBe('READY');
    const headers = { authorization: `Bearer ${opsToken}`, 'content-type': 'application/json' };
    const requestId = randomUUID();
    expect(
      (
        await fetch(server.endpoint + '/api/operations/commands', {
          method: 'POST',
          headers,
          body: JSON.stringify({ requestId, action: 'resume' }),
        })
      ).status,
    ).toBe(202);
    await expect
      .poll(
        async () =>
          (
            (await (
              await fetch(server.endpoint + `/api/operations/commands/${requestId}`, { headers })
            ).json()) as { status: string }
          ).status,
      )
      .toBe('succeeded');
    const report = await runDeploymentSmoke({
      mode: 'local-contract',
      baseUrl: server.endpoint,
      origin: 'http://localhost:5173',
      cookie: '',
      opsToken,
      preflight: localDeploymentPlan(),
      deviceManifest: localDeploymentDevices,
      advanceLocalRound: (roomCode) => server.advanceTicks(roomCode, 3650),
      async createProbe(playerId): Promise<DeploymentMediaProbe> {
        let grant: MediaGrant | null = null;
        let published = false;
        let bindings: MediaBindings | null = null;
        let audio: AudioPolicy | null = null;
        return {
          async connect(value) {
            grant = value;
            published = false;
          },
          async publish() {
            if (!grant) throw new Error('LOCAL_NOT_CONNECTED');
            await server.publish(grant);
            published = true;
          },
          async applyBindings(value) {
            bindings = value;
          },
          async applyAudioPolicy(value) {
            audio = value;
          },
          async snapshot() {
            const sameScope =
              !!grant &&
              bindings?.mediaInstanceId === grant.mediaInstanceId &&
              bindings.receiverGeneration === grant.receiverGeneration;
            return {
              connected: grant !== null,
              localTracks:
                grant && published
                  ? [
                      { sid: `FACE_${grant.mediaIdentity}`, kind: 'video' as const },
                      { sid: `AUDIO_${grant.mediaIdentity}`, kind: 'audio' as const },
                    ]
                  : [],
              allowedReceived: {
                // Synthetic observations derive only from actual E permissions/bindings.
                video: sameScope
                  ? bindings!.participants.filter(
                      (p) => p.playerId !== playerId && !!p.faceTrackSid,
                    ).length
                  : 0,
                audio:
                  sameScope && audio && audio.bindingRevision === bindings?.bindingRevision
                    ? audio.voices.filter(
                        (voice) =>
                          voice.playerId !== playerId &&
                          voice.gain > 0 &&
                          bindings!.participants.some(
                            (p) =>
                              p.playerId === voice.playerId && p.audioTrackSid === voice.trackSid,
                          ),
                      ).length
                    : 0,
              },
              forbiddenReceived: 0,
            };
          },
          async close() {
            grant = null;
            published = false;
            bindings = null;
            audio = null;
          },
        };
      },
    });
    expect(report, JSON.stringify(report)).toMatchObject({
      status: 'PASS',
      evidenceScope: 'LOCAL_CONTRACT_ONLY',
      participants: 6,
      received: { practiceVideo: true, practiceAudio: true, gameVideo: true, gameAudio: true },
      mediaRooms: { practice: 2, game: 1 },
      cleanup: { clientsClosed: 6, drainConfirmed: true, resumed: true },
    });
    expect(report.gameInputsApplied).toBeGreaterThan(0);
    expect(report.phaseCoverage).toEqual(
      expect.arrayContaining(['TEAM_PRACTICE', 'GAME_LOADING', 'PLAYING', 'RESULT']),
    );
    expect((await server.inspect()).participantCount).toBe(0);
  } finally {
    await server.close();
  }
}, 180_000);
