import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { createServer, type ViteDevServer } from 'vite';
import { it } from 'vitest';
import { caseTimeoutMs, requireCloudPreflight } from '../../../tests/cloud/CloudPreflight.js';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import {
  GatewayError,
  LiveKitGateway,
  type GatewayObservation,
} from '../../src/media/LiveKitGateway.js';
import { validateCapabilityPlan } from './cloud/capability-evidence.js';
import type { Marker, Measurement } from './cloud/capability-browser.js';
import { splitMediaVerdict, type SplitMediaEvidence } from './cloud/split-media-evidence.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const preflight = requireCloudPreflight('MC-PUBLIC-02', process.env, Date.now(), root);
const config = validateCapabilityPlan(preflight, process.env);
if (
  !preflight.namespace.startsWith('qa-public-') ||
  preflight.maxRooms !== 3 ||
  preflight.maxParticipants !== 8
)
  throw new Error('SPLIT_PROBE_REQUIRES_ISOLATED_THREE_ROOMS_EIGHT_PARTICIPANT_RESERVATION');
if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('SPLIT_PROBE_DISABLE_TOKEN_TRACING');
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !==
    preflight.sourceCommit ||
  createHash('sha256')
    .update(await readFile(resolve(root, 'pnpm-lock.yaml')))
    .digest('hex') !== preflight.lockfileHash ||
  execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
)
  throw new Error('SPLIT_PROBE_REQUIRES_CLEAN_APPROVED_SOURCE');

it(
  'MC-PUBLIC-02 keeps faces while blocking and reallowing isolated audio on the same destination',
  async () => {
    const evidence: SplitMediaEvidence = {
      separatedSourcePermissions: false,
      faceOnlyReceived: false,
      directAudioBlocked: false,
      audioAllowedFresh: false,
      audioRemovedBlocked: false,
      sameDestinationReallowedFresh: false,
      reverseAudioAllowedFresh: false,
      receiverBindingsValidated: false,
      cleanupConfirmed: false,
    };
    const sidRelations: { kind: string; sameTrackSid: boolean; sameParticipantSid: boolean }[] = [];
    const timingsMs: Record<string, number | null> = {
      audioAllow: null,
      audioRemoveAndConfirm: null,
      audioReallow: null,
    };
    const samples: { phase: string; measurement: Measurement }[] = [];
    const observations: GatewayObservation[] = [];
    const rooms: string[] = [];
    // Include uncertain forward dispatches and minted-but-never-connected identities in cleanup.
    const identities = new Map<string, Set<string>>();
    const start = performance.now();
    const deadline = start + preflight.maxDurationSeconds * 1000;
    const finalDeadline = deadline + preflight.cleanupAllowanceSeconds * 1000;
    let cleanupDeadline = finalDeadline;
    let cleaning = false;
    let browser: Browser | undefined;
    let vite: ViteDevServer | undefined;
    let failure: string | null = null;
    let issuedIdentities = 0;
    const calls = { normal: 0, cleanup: 0 };
    const budget = new ApiBudget({
      monotonicNow: () => performance.now(),
      maxNormalCallsPer60s: 40,
      maxTotalCallsPer60s: 70,
    });
    const gateway = new LiveKitGateway(config, budget, {
      monotonicNow: () => performance.now(),
      requestTimeoutMs: 10_000,
      observe: (value) => observations.push(value),
    });
    const guard = () => {
      if (
        performance.now() >= (cleaning ? cleanupDeadline : deadline) ||
        (!cleaning && Date.now() >= preflight.expiresAtEpochMs)
      )
        throw new Error('SPLIT_PROBE_DEADLINE');
    };
    const context = (cleanup = false) => {
      guard();
      const priority = cleanup ? 'cleanup' : 'normal';
      if (++calls[priority] > (cleanup ? 30 : 40)) throw new Error('SPLIT_PROBE_API_LIMIT');
      return {
        requestId: randomUUID(),
        deadlineMs: Math.min(performance.now() + 10_000, cleaning ? cleanupDeadline : deadline),
        priority,
        beforeDispatch: () => {
          guard();
          return true;
        },
      } as const;
    };
    const remember = (room: string, identity: string) => {
      const set = identities.get(room) ?? new Set<string>();
      set.add(identity);
      identities.set(room, set);
    };
    const createRoom = async () => {
      if (rooms.length >= 3) throw new Error('SPLIT_PROBE_ROOM_LIMIT');
      const name = preflight.namespace + '--' + randomUUID();
      rooms.push(name);
      await gateway.createRoom(
        { name, maxParticipants: 5, emptyTimeout: 30, departureTimeout: 30 },
        context(),
      );
      return name;
    };
    const mint = async (room: string, source: 'face' | 'audio') => {
      guard();
      if (++issuedIdentities > 4) throw new Error('SPLIT_PROBE_IDENTITY_LIMIT');
      const identity = preflight.namespace + '--' + randomUUID();
      remember(room, identity);
      const token = new AccessToken(config.apiKey, config.apiSecret, { identity, ttl: 300 });
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: source === 'audio',
        canPublishData: false,
        canPublishSources: [source === 'face' ? TrackSource.CAMERA : TrackSource.MICROPHONE],
        roomAdmin: false,
        roomRecord: false,
        roomCreate: false,
        roomList: false,
      });
      return { identity, token: await token.toJwt() };
    };
    const connect = async (page: Page, token: string, publisherMode = false) => {
      guard();
      const result = await page.evaluate(
        ({ url, token, publisherMode }) =>
          window.capabilityProbe.connect(url, token, publisherMode),
        { url: config.wsUrl, token, publisherMode },
      );
      if (result.outcome !== 'connected') throw new Error('SPLIT_PROBE_CONNECT_UNCONFIRMED');
    };
    const sleep = async () => {
      guard();
      await new Promise((done) => setTimeout(done, 100));
      guard();
    };
    const measure = async (page: Page) => {
      guard();
      return page.evaluate(() => window.capabilityProbe.measure());
    };
    const received = (marker: Marker) => (m: Measurement) =>
      m.connected &&
      m.marker === marker &&
      m.frequency !== null &&
      Math.abs(m.frequency - { 1: 660, 2: 880, 3: 1100 }[marker]) < 50 &&
      m.bytesReceived > 0 &&
      m.audioBytesReceived > 0;
    const waitFor = async (
      page: Page,
      predicate: (measurement: Measurement) => boolean,
      phase: string,
    ) => {
      const until = Math.min(deadline, performance.now() + 8_000);
      let last: Measurement | undefined;
      while (performance.now() < until) {
        last = await measure(page);
        if (predicate(last)) {
          samples.push({ phase, measurement: last });
          return true;
        }
        await sleep();
      }
      if (last) samples.push({ phase: phase + '-unconfirmed', measurement: last });
      return false;
    };
    const audioBlocked = async (page: Page, marker: Marker, phase: string) => {
      // A newly changed face is the positive control; silence alone cannot pass this check.
      if (!(await waitFor(page, (m) => m.marker === marker && m.subscribed === 1, phase + '-face')))
        return false;
      for (let i = 0; i < 20; i++) {
        const m = await measure(page);
        if (
          !m.connected ||
          m.marker !== marker ||
          m.subscribed !== 1 ||
          m.bytesReceived <= 0 ||
          m.audioBytesReceived !== 0 ||
          m.frequency !== null
        ) {
          samples.push({ phase: phase + '-not-blocked', measurement: m });
          return false;
        }
        if (i === 0 || i === 19) samples.push({ phase, measurement: m });
        await sleep();
      }
      return true;
    };
    const forward = async (from: string, identity: string, to: string) => {
      remember(to, identity);
      await gateway.forwardParticipant(from, identity, to, context());
    };
    const revoke = async (room: string, identity: string) => {
      try {
        await gateway.removeParticipant(
          room,
          identity,
          { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 5) },
          context(true),
        );
      } catch (error) {
        if (!(error instanceof GatewayError) || error.code !== 'not_found') throw error;
      }
    };
    const watchdog = setTimeout(() => {
      void browser?.close().catch(() => {});
    }, preflight.maxDurationSeconds * 1000);
    let cleanupWatchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      await mkdir(resolve(root, preflight.evidenceDir), { recursive: true });
      vite = await createServer({
        configFile: false,
        root: fileURLToPath(new URL('./cloud/', import.meta.url)),
        cacheDir: resolve(root, '.local/qa/split-probe-vite-cache'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0 },
      });
      await vite.listen();
      const local = vite.resolvedUrls?.local[0];
      if (!local) throw new Error('SPLIT_PROBE_LOCAL_UNAVAILABLE');
      browser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=no-user-gesture-required'],
      });
      const pages: Page[] = [];
      for (let i = 0; i < 4; i++) {
        const page = await browser.newPage();
        page.setDefaultTimeout(8000);
        await page.goto(local + 'capability.html');
        await page.waitForFunction(() => !!window.capabilityProbe);
        pages.push(page);
      }
      const [faceA, voiceA, faceB, voiceB] = pages as [Page, Page, Page, Page];
      const faceRoom = await createRoom();
      const receiverA = await createRoom();
      const receiverB = await createRoom();
      const fa = await mint(faceRoom, 'face');
      const va = await mint(receiverA, 'audio');
      const fb = await mint(faceRoom, 'face');
      const vb = await mint(receiverB, 'audio');
      for (const [page, credential] of [
        [faceA, fa],
        [voiceA, va],
        [faceB, fb],
        [voiceB, vb],
      ] as const)
        await connect(page, credential.token);
      const faceASids = await faceA.evaluate(() => window.capabilityProbe.publish('face'));
      const audioASids = await voiceA.evaluate(() => window.capabilityProbe.publish('audio'));
      const faceBSids = await faceB.evaluate(() => window.capabilityProbe.publish('face'));
      const audioBSids = await voiceB.evaluate(() => window.capabilityProbe.publish('audio'));
      if (
        [faceASids, audioASids, faceBSids, audioBSids].some((sids) => sids.length !== 1 || !sids[0])
      )
        throw new Error('SPLIT_PROBE_PUBLISH_UNCONFIRMED');
      const sourceParticipants: Awaited<ReturnType<LiveKitGateway['getParticipant']>>[] = [];
      for (const [roomName, credential, source] of [
        [faceRoom, fa, TrackSource.CAMERA],
        [receiverA, va, TrackSource.MICROPHONE],
        [faceRoom, fb, TrackSource.CAMERA],
        [receiverB, vb, TrackSource.MICROPHONE],
      ] as const) {
        const participant = await gateway.getParticipant(roomName, credential.identity, context());
        sourceParticipants.push(participant);
        if (
          !participant.permission?.canPublish ||
          participant.permission.canPublishData ||
          participant.permission.canSubscribe !== (source === TrackSource.MICROPHONE) ||
          participant.permission.canPublishSources.length !== 1 ||
          participant.permission.canPublishSources[0] !== source ||
          participant.tracks.length !== 1 ||
          participant.tracks[0]!.source !== source
        )
          throw new Error('SPLIT_PROBE_SOURCE_PERMISSION_UNCONFIRMED');
      }
      evidence.separatedSourcePermissions = true;
      // Both sources deliberately allow every other identity. Destination tokens still cannot
      // subscribe to audio in another room without a server forwarding operation.
      for (const page of pages)
        await page.evaluate(
          (identities) => window.capabilityProbe.restrictSubscribers(identities),
          [fa.identity, va.identity, fb.identity, vb.identity],
        );
      await forward(faceRoom, fa.identity, receiverB);
      await forward(faceRoom, fb.identity, receiverA);
      await waitFor(voiceB, (m) => m.publications === 1, 'face-b-visible');
      await waitFor(voiceA, (m) => m.publications === 1, 'face-a-visible');
      await voiceA.evaluate(() => window.capabilityProbe.directSubscribe());
      await voiceB.evaluate(() => window.capabilityProbe.directSubscribe());
      evidence.faceOnlyReceived = await waitFor(
        voiceB,
        (m) => m.connected && m.marker === 1 && m.bytesReceived > 0 && m.subscribed === 1,
        'face-only-positive',
      );
      evidence.directAudioBlocked = await audioBlocked(voiceB, 1, 'hostile-direct-audio-blocked');

      const allowStarted = performance.now();
      await forward(receiverA, va.identity, receiverB);
      await waitFor(voiceB, (m) => m.publications === 2, 'audio-visible');
      await voiceB.evaluate(() => window.capabilityProbe.directSubscribe());
      await faceA.evaluate(() => window.capabilityProbe.setMarker(2));
      await voiceA.evaluate(() => window.capabilityProbe.setMarker(2));
      evidence.audioAllowedFresh = await waitFor(voiceB, received(2), 'audio-allowed-new-media');
      if (evidence.audioAllowedFresh) timingsMs.audioAllow = performance.now() - allowStarted;

      const destinationParticipants = [
        await gateway.getParticipant(receiverB, fa.identity, context()),
        await gateway.getParticipant(receiverB, va.identity, context()),
      ];
      const publications = await voiceB.evaluate(() => window.capabilityProbe.publications());
      evidence.receiverBindingsValidated =
        publications.length === 2 &&
        destinationParticipants.every((participant, index) => {
          const source = sourceParticipants[index]!;
          const publication = publications.find((p) => p.mediaIdentity === participant.identity);
          const track = participant.tracks[0];
          sidRelations.push({
            kind: index === 0 ? 'face' : 'audio',
            sameTrackSid: track?.sid === source.tracks[0]?.sid,
            sameParticipantSid: participant.sid === source.sid,
          });
          return (
            participant.identity === source.identity &&
            !!publication &&
            !!participant.sid &&
            participant.sid === publication.participantSid &&
            participant.tracks.length === 1 &&
            !!track?.sid &&
            track.sid === publication.trackSid &&
            track.source === (index === 0 ? TrackSource.CAMERA : TrackSource.MICROPHONE)
          );
        });

      // Removing the forwarded identity must not close the original publisher's room or face.
      const removalStarted = performance.now();
      await revoke(receiverB, va.identity);
      await waitFor(voiceB, (m) => m.subscribed === 1, 'audio-removed');
      await voiceB.evaluate(() => window.capabilityProbe.directSubscribe());
      await faceA.evaluate(() => window.capabilityProbe.setMarker(3));
      await voiceA.evaluate(() => window.capabilityProbe.setMarker(3));
      evidence.audioRemovedBlocked = await audioBlocked(voiceB, 3, 'audio-removed-face-remains');
      if (evidence.audioRemovedBlocked)
        timingsMs.audioRemoveAndConfirm = performance.now() - removalStarted;

      const reallowStarted = performance.now();
      await forward(receiverA, va.identity, receiverB);
      await waitFor(voiceB, (m) => m.publications === 2, 'same-destination-visible-again');
      await voiceB.evaluate(() => window.capabilityProbe.directSubscribe());
      await faceA.evaluate(() => window.capabilityProbe.setMarker(1));
      await voiceA.evaluate(() => window.capabilityProbe.setMarker(1));
      evidence.sameDestinationReallowedFresh = await waitFor(
        voiceB,
        received(1),
        'same-destination-reallow',
      );
      if (evidence.sameDestinationReallowedFresh)
        timingsMs.audioReallow = performance.now() - reallowStarted;
      const reallowed = await gateway.getParticipant(receiverB, va.identity, context());
      const reallowedPublication = (
        await voiceB.evaluate(() => window.capabilityProbe.publications())
      ).find((publication) => publication.mediaIdentity === va.identity);
      evidence.receiverBindingsValidated &&=
        !!reallowedPublication &&
        reallowed.sid === reallowedPublication.participantSid &&
        reallowed.tracks.length === 1 &&
        reallowed.tracks[0]!.sid === reallowedPublication.trackSid &&
        reallowed.tracks[0]!.source === TrackSource.MICROPHONE;
      sidRelations.push({
        kind: 'audio-reallowed',
        sameTrackSid: reallowed.tracks[0]?.sid === sourceParticipants[1]!.tracks[0]?.sid,
        sameParticipantSid: reallowed.sid === sourceParticipants[1]!.sid,
      });

      await forward(receiverB, vb.identity, receiverA);
      await waitFor(voiceA, (m) => m.publications === 2, 'reverse-audio-visible');
      await voiceA.evaluate(() => window.capabilityProbe.directSubscribe());
      await faceB.evaluate(() => window.capabilityProbe.setMarker(3));
      await voiceB.evaluate(() => window.capabilityProbe.setMarker(3));
      evidence.reverseAudioAllowedFresh = await waitFor(voiceA, received(3), 'reverse-new-media');
    } catch (error) {
      failure =
        error instanceof Error && /^SPLIT_PROBE_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'SPLIT_PROBE_UNCONFIRMED';
    } finally {
      cleaning = true;
      clearTimeout(watchdog);
      cleanupDeadline = Math.min(
        finalDeadline,
        performance.now() + preflight.cleanupAllowanceSeconds * 1000,
      );
      cleanupWatchdog = setTimeout(
        () => {
          void browser?.close().catch(() => {});
        },
        Math.max(1, cleanupDeadline - performance.now()),
      );
      let confirmed = true;
      try {
        await browser?.close();
      } catch {
        confirmed = false;
      }
      for (const room of rooms) {
        for (const identity of identities.get(room) ?? []) {
          try {
            await revoke(room, identity);
          } catch {
            confirmed = false;
          }
        }
        try {
          const remaining = await gateway.listParticipants(room, context(true));
          if (remaining.length) {
            confirmed = false;
            continue;
          }
          await gateway.deleteRoom(room, context(true));
        } catch (error) {
          if (!(error instanceof GatewayError) || error.code !== 'not_found') confirmed = false;
        }
      }
      try {
        if (rooms.length && (await gateway.listRooms(rooms, context(true))).length)
          confirmed = false;
      } catch {
        confirmed = false;
      }
      try {
        await vite?.close();
      } catch {
        confirmed = false;
      }
      clearTimeout(cleanupWatchdog);
      budget.close();
      evidence.cleanupConfirmed = confirmed;
    }
    const verdict = splitMediaVerdict(evidence);
    await writeFile(
      resolve(root, preflight.evidenceDir, 'split-media-evidence.json'),
      JSON.stringify(
        {
          case: 'MC-PUBLIC-02',
          sourceCommit: preflight.sourceCommit,
          lockfileHash: preflight.lockfileHash,
          namespace: preflight.namespace,
          testedAtEpochMs: Date.now(),
          durationMs: Math.ceil(performance.now() - start),
          evidence,
          verdict,
          failure,
          sidRelations,
          timingsMs,
          calls,
          observations,
          samples,
          limitations: [
            'isolated synthetic transport probe only',
            'not product integration, G1 acceptance, capacity, or permission to open production',
          ],
        },
        null,
        2,
      ) + '\n',
    );
    if (failure || !verdict.splitTransportVerified)
      throw new Error(failure ?? 'SPLIT_PROBE_NO_VERIFIED_CANDIDATE');
  },
  caseTimeoutMs(preflight) + 10_000,
);
