// Actual public A/B/C/E/F consumers. Transport counters below are fixtures, not Cloud RTP evidence.
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type {
  AudioPolicy,
  MediaBindings,
  MediaGrant,
} from '../../apps/web/src/features/input/InteractionRuntime';
import { startProductServerProcess } from '../../server/test/media/product-server-process.js';
import { runDeploymentSmoke } from '../cloud/DeploymentSmokeHarness.js';
import type { DeploymentMediaProbe } from '../cloud/DeploymentInteraction.js';
import { localDeploymentDevices, localDeploymentPlan } from '../fixtures/deployment-smoke-plan.js';

it.each(['DRAINING', 'LOCKED'])(
  'DP06 confirms terminal drain in %s after browser initialization fails',
  async (admission) => {
    const opsToken = randomUUID();
    const server = await startProductServerProcess(opsToken);
    const realFetch = globalThis.fetch;
    let failed = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await realFetch(input, init);
      if (
        failed &&
        String(input) === server.endpoint + '/api/operations/status' &&
        admission === 'LOCKED'
      ) {
        const status = await response.json();
        return Response.json({ ...status, readiness: 'LOCKED', admission });
      }
      return response;
    });
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
          failed = true;
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
      fetchSpy.mockRestore();
      await server.close();
    }
  },
  30_000,
);

it('DP06 local harness follows real six-client grant/phase/input/retirement APIs', async () => {
  const opsToken = randomUUID();
  const server = await startProductServerProcess(opsToken);
  let probes = 0;
  try {
    // S15P21C204-302. This run's positive in-game audio evidence is a coin flip on the corridor
    // maze, so the child pins the open grid. Asserted here because the first attempt at that pin
    // set an environment variable the child never reads, and nothing said so: the run stayed on
    // the maze and failed in CI. S15P21C204-308 removes the pin and this expectation with it.
    // S15P21C204-308. The local contract runs the product default now that in-game audio evidence
    // no longer depends on where a random walk goes.
    expect(server.mapTemplate).toBe('maze-v1');
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
        // S15P21C204-324. The first client fails its first close after the game scope opened,
        // which is the teardown every client starts the moment it sees RESULT. That used to flip
        // the harness's media-failure flag while the other five were still arriving at RESULT and
        // report a failed game for a round that had just finished. The run must still pass, with
        // the stumble recorded, because the closure below is re-verified afterwards.
        const chosen = probes++ === 0;
        let connects = 0;
        let closesInGame = 0;
        const failsTeardownOnce = () => chosen && connects === 2 && ++closesInGame === 1;
        return {
          async connect(value) {
            grant = value;
            published = false;
            connects++;
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
            // Leaves the probe reporting itself open, which is how an unconfirmed retirement
            // looks; the very next close succeeds, as a slow browser call would.
            if (failsTeardownOnce()) return;
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
      // S15P21C204-324. The injected teardown stumble is recorded, and every client is still
      // confirmed closed: the round's verdict does not hang on that first attempt.
      cleanup: { clientsClosed: 6, drainConfirmed: true, resumed: true, retirementUnconfirmed: 1 },
    });
    expect(report.gameInputsApplied).toBeGreaterThan(0);
    expect(report.phaseCoverage).toEqual(
      expect.arrayContaining(['TEAM_PRACTICE', 'GAME_LOADING', 'PLAYING', 'RESULT']),
    );
    expect((await server.inspect()).participantCount).toBe(0);
  } finally {
    await server.close();
  }
  // S15P21C204-302: the harness now allows 240s plus a 30s cleanup on the corridor maze.
}, 330_000);
