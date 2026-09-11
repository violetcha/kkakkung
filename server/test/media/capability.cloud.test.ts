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
  DEFAULT_CLOUD_REQUEST_TIMEOUT_MS,
  GatewayError,
  LiveKitGateway,
  type GatewayObservation,
} from '../../src/media/LiveKitGateway.js';
import {
  capabilityReport,
  confirmIdentityCleanup,
  CUTOFF_BUFFER_SECONDS,
  emptyEvidence,
  validateCapabilityPlan,
} from './cloud/capability-evidence.js';
import type { ConnectionResult, Marker, Measurement } from './cloud/capability-browser.js';

// No skip/default SUPPORTED: the official runner and this entry both refuse missing evidence.
// Never import .env here. F injects credentials and an approved preflight into the process.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const preflight = requireCloudPreflight('MC-01', process.env, Date.now(), root);
const config = validateCapabilityPlan(preflight, process.env);
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !==
    preflight.sourceCommit ||
  createHash('sha256')
    .update(await readFile(resolve(root, 'pnpm-lock.yaml')))
    .digest('hex') !== preflight.lockfileHash
)
  throw new Error('MC01_SOURCE_OR_LOCKFILE_CHANGED');
if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('MC01_DISABLE_DEBUG_TOKEN_TRACING');
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim())
  throw new Error('MC01_UNCOMMITTED_SOURCE');

it(
  'MC-01 verifies minimum grants, fresh media, original/refreshed token revocation, and cleanup in actual Cloud',
  async () => {
    const evidence = emptyEvidence();
    const observations: GatewayObservation[] = [];
    const samples: { phase: string; measurement: Measurement }[] = [];
    const denials: { phase: string; result: ConnectionResult }[] = [];
    // Exploratory publisher-controlled profile. Never promotes the product's minimum grant.
    const publisherPermissions = { allowed: false, denied: false, switched: false, retired: false };
    let publisherPermissionsAttempted = false;
    const publisherMode = process.env.MEDIA_SUBSCRIPTION_MODE === 'publisher-permissions';
    const roomName = `${preflight.namespace}--${randomUUID()}`;
    const start = performance.now();
    const deadline = start + Math.min(preflight.maxDurationSeconds, 240) * 1000;
    const finalDeadline = deadline + preflight.cleanupAllowanceSeconds * 1000;
    let cleanupDeadline = finalDeadline;
    let cleaning = false;
    let browser: Browser | undefined;
    let vite: ViteDevServer | undefined;
    let roomAttempted = false;
    let localCleanupConfirmed = true;
    let failure = 'MC01_UNCONFIRMED';
    const identities = new Set<string>();
    const revoked = new Set<string>();
    const calls = { normal: 0, cleanup: 0 };
    const guard = () => {
      if (
        performance.now() >= (cleaning ? cleanupDeadline : deadline) ||
        (!cleaning && Date.now() >= preflight.expiresAtEpochMs)
      )
        throw new Error('MC01_DEADLINE');
    };
    const apiBudget = new ApiBudget({
      monotonicNow: () => performance.now(),
      maxNormalCallsPer60s: 40,
      maxTotalCallsPer60s: 60,
    });
    const gateway = new LiveKitGateway(config, apiBudget, {
      monotonicNow: () => performance.now(),
      requestTimeoutMs: DEFAULT_CLOUD_REQUEST_TIMEOUT_MS,
      observe: (value) => observations.push(value),
    });
    const context = (cleanup = false) => {
      guard();
      const bucket = cleanup ? 'cleanup' : 'normal';
      // Total case cap, in addition to the shared rolling budget. No implicit replay.
      if (++calls[bucket] > (cleanup ? 20 : 40)) throw new Error('MC01_API_BUDGET');
      return {
        requestId: randomUUID(),
        deadlineMs: Math.min(performance.now() + 1000, cleaning ? cleanupDeadline : deadline),
        priority: cleanup ? ('cleanup' as const) : ('normal' as const),
        beforeDispatch: () => {
          guard();
          return true;
        },
      };
    };
    const abortBrowser = () => {
      void browser?.close().catch(() => {});
    };
    const watchdog = setTimeout(abortBrowser, Math.max(1, deadline - performance.now()));
    let cleanupWatchdog: ReturnType<typeof setTimeout> | undefined;
    const sleep = async (ms: number) => {
      guard();
      await new Promise((done) => setTimeout(done, ms));
      guard();
    };
    const measure = async (page: Page) => {
      guard();
      return page.evaluate(() => window.capabilityProbe.measure());
    };
    const waitFor = async (page: Page, condition: (m: Measurement) => boolean, phase: string) => {
      const until = Math.min(deadline, performance.now() + 10_000);
      let lastMeasurement: Measurement | undefined;
      while (performance.now() < until) {
        const measurement = await measure(page);
        lastMeasurement = measurement;
        if (condition(measurement)) {
          samples.push({ phase, measurement });
          return;
        }
        await sleep(100);
      }
      // Persist only bounded non-secret measurements, including the failed phase.
      if (lastMeasurement)
        samples.push({ phase: `${phase}-timeout`, measurement: lastMeasurement });
      throw new Error('MC01_MEASUREMENT_UNCONFIRMED');
    };
    const markerReceived = (marker: Marker) => (m: Measurement) =>
      m.connected &&
      m.marker === marker &&
      m.frequency !== null &&
      Math.abs(m.frequency - { 1: 660, 2: 880, 3: 1100 }[marker]) < 50 &&
      m.bytesReceived > 0;
    const proveBlocked = async (page: Page, phase: string) => {
      for (let i = 0; i < 30; i++) {
        const m = await measure(page);
        if (
          !m.connected ||
          m.publications !== 2 ||
          m.subscribed !== 0 ||
          m.marker !== null ||
          m.frequency !== null ||
          m.bytesReceived !== 0
        )
          throw new Error('MC01_FORBIDDEN_MEDIA_OR_INVALID_CONTROL');
        if (i === 0 || i === 29) samples.push({ phase, measurement: m });
        await sleep(100);
      }
    };
    const mint = async () => {
      guard();
      if (identities.size >= 5) throw new Error('MC01_IDENTITY_BUDGET');
      const identity = `${preflight.namespace}--${randomUUID()}`;
      identities.add(identity); // Include uncertain signing/connecting attempts in final cleanup.
      const token = new AccessToken(config.apiKey, config.apiSecret, { identity, ttl: 300 });
      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: publisherMode,
        canPublishData: false,
        canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
        roomAdmin: false,
        roomRecord: false,
        roomCreate: false,
        roomList: false,
      });
      const jwt = await token.toJwt();
      const { nbf } = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as {
        nbf: number;
      };
      if (!Number.isSafeInteger(nbf)) throw new Error('MC01_INVALID_ISSUED_TIME');
      return { identity, token: jwt, issuedSecond: nbf };
    };
    const revoke = async (identity: string) => {
      const ctx = context(true);
      const cutoff = BigInt(Math.floor(Date.now() / 1000) + CUTOFF_BUFFER_SECONDS);
      let dispatchedSecond: number | null = null;
      await gateway.removeParticipant(
        roomName,
        identity,
        { revokeTokenTs: cutoff },
        {
          ...ctx,
          beforeDispatch: () => {
            ctx.beforeDispatch();
            dispatchedSecond = Math.floor(Date.now() / 1000);
            return true;
          },
        },
      );
      revoked.add(identity);
      return dispatchedSecond;
    };
    const assertAbsent = async (identity: string) => {
      try {
        await gateway.getParticipant(roomName, identity, context(true));
      } catch (error) {
        if (error instanceof GatewayError && error.code === 'not_found') return;
        throw error;
      }
      throw new Error('MC01_PARTICIPANT_REMAINS');
    };
    const connected = (result: ConnectionResult) => {
      if (result.outcome !== 'connected') throw new Error('MC01_CONTROL_CONNECT_FAILED');
    };
    const denied = (phase: string, result: ConnectionResult) => {
      denials.push({ phase, result });
      if (result.outcome !== 'denied' || ![401, 403].includes(result.status ?? 0))
        throw new Error('MC01_TOKEN_REJECTION_UNCONFIRMED');
    };
    try {
      await mkdir(resolve(root, preflight.evidenceDir), { recursive: true });
      vite = await createServer({
        configFile: false,
        root: fileURLToPath(new URL('./cloud/', import.meta.url)),
        cacheDir: resolve(root, '.local/qa/mc01-vite-cache'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false },
      });
      await vite.listen();
      const localUrl = vite.resolvedUrls?.local[0];
      if (!localUrl) throw new Error('MC01_LOCAL_PROBE_UNAVAILABLE');
      browser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=no-user-gesture-required'],
      });
      const newPage = async () => {
        guard();
        const page = await browser!.newPage();
        page.setDefaultTimeout(8000);
        await page.goto(`${localUrl}capability.html`);
        await page.waitForFunction(() => !!window.capabilityProbe);
        return page;
      };
      // Local browser dependencies must be available BEFORE the first actual Cloud request.
      const publisher = await newPage();
      const allowed = await newPage();
      const forbidden = await newPage();
      const unused = await newPage();
      const control = await newPage();
      guard();
      roomAttempted = true;
      const before = Date.now();
      const room = await gateway.createRoom(
        { name: roomName, maxParticipants: 5, emptyTimeout: 30, departureTimeout: 30 },
        context(),
      );
      const after = Date.now();
      const serverTime = Number(room.creationTime) * 1000;
      if (!Number.isSafeInteger(serverTime) || serverTime <= 0)
        throw new Error('MC01_SERVER_CLOCK_UNAVAILABLE');
      evidence.clockOffsetUpperBoundMs =
        Math.max(Math.abs(serverTime - before), Math.abs(serverTime - after)) + 1000;
      if (evidence.clockOffsetUpperBoundMs + CUTOFF_BUFFER_SECONDS * 1000 >= 60_000)
        throw new Error('MC01_SERVER_CLOCK_UNCONFIRMED');
      const p = await mint();
      const a = await mint();
      const d = await mint();
      for (const [page, credential] of [
        [publisher, p],
        [allowed, a],
        [forbidden, d],
      ] as const)
        connected(
          await page.evaluate(
            ({ url, token, publisherMode }) =>
              window.capabilityProbe.connect(url, token, publisherMode),
            {
              url: config.wsUrl,
              token: credential.token,
              publisherMode,
            },
          ),
        );
      try {
        const tracks = await publisher.evaluate(() => window.capabilityProbe.publish());
        if (tracks.length !== 2 || tracks.some((sid) => !sid))
          throw new Error('MC01_PUBLISH_UNCONFIRMED');
        await waitFor(forbidden, (m) => m.connected && m.publications === 2, 'tracks-visible');
        if ((await forbidden.evaluate(() => window.capabilityProbe.directSubscribe())) !== 2)
          throw new Error('MC01_DIRECT_SUBSCRIBE_NOT_ATTEMPTED');
        if (publisherMode)
          await publisher.evaluate(
            (permissions) => window.capabilityProbe.restrictTracks(permissions),
            [{ participantIdentity: a.identity, allowedTrackSids: tracks }],
          );
        await gateway.updateSubscriptions(roomName, a.identity, tracks, true, context());
        await publisher.evaluate(() => window.capabilityProbe.setMarker(1));
        await waitFor(allowed, markerReceived(1), 'allowed-green-660Hz');
        evidence.allowReceived = true;
        await proveBlocked(forbidden, 'direct-subscribe-denied');
        evidence.forbiddenRejected = true;
        // The very same forbidden client must subsequently decode a fresh positive control.
        if (publisherMode)
          await publisher.evaluate(
            (permissions) => window.capabilityProbe.restrictTracks(permissions),
            [
              { participantIdentity: a.identity, allowedTrackSids: tracks },
              { participantIdentity: d.identity, allowedTrackSids: tracks },
            ],
          );
        await gateway.updateSubscriptions(roomName, d.identity, tracks, true, context());
        await publisher.evaluate(() => window.capabilityProbe.setMarker(2));
        await waitFor(forbidden, markerReceived(2), 'denied-client-positive-blue-880Hz');
        evidence.deniedClientPositiveControl = true;
        if (publisherMode)
          await publisher.evaluate(
            (permissions) => window.capabilityProbe.restrictTracks(permissions),
            [{ participantIdentity: a.identity, allowedTrackSids: tracks }],
          );
        await gateway.updateSubscriptions(roomName, d.identity, tracks, false, context(true));
        await waitFor(forbidden, (m) => m.connected && m.subscribed === 0, 'unsubscribe-ack');
        await publisher.evaluate(() => window.capabilityProbe.setMarker(3));
        await waitFor(allowed, markerReceived(3), 'fresh-yellow-1100Hz');
        if (publisherMode) await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
        await proveBlocked(forbidden, 'remote-unsubscribe-blocked');
        evidence.revokedSubscriptionBlocked = true;
      } catch (error) {
        // A measured reception failure does not prevent independent token-revocation probes.
        // Keep the permission evidence false; budget, transport and cleanup errors still abort.
        if (!(error instanceof Error) || error.message !== 'MC01_MEASUREMENT_UNCONFIRMED')
          throw error;
        failure = 'MC01_RECEPTION_UNCONFIRMED';
      }

      if (!publisherMode && failure === 'MC01_RECEPTION_UNCONFIRMED') {
        publisherPermissionsAttempted = true;
        await publisher.evaluate(
          (identity) => window.capabilityProbe.restrictSubscribers([identity]),
          a.identity,
        );
        for (const identity of [a.identity, d.identity])
          await gateway.updateParticipant(
            roomName,
            identity,
            {
              permission: {
                canSubscribe: true,
                canPublish: true,
                canPublishData: false,
                canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
              },
            },
            context(),
          );
        try {
          await allowed.evaluate(() => window.capabilityProbe.directSubscribe());
          await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
          await publisher.evaluate(() => window.capabilityProbe.setMarker(1));
          await waitFor(allowed, markerReceived(1), 'publisher-permissions-allowed');
          publisherPermissions.allowed = true;
          await proveBlocked(forbidden, 'publisher-permissions-direct-denied');
          publisherPermissions.denied = true;
          await publisher.evaluate(
            (identity) => window.capabilityProbe.restrictSubscribers([identity]),
            d.identity,
          );
          await publisher.evaluate(() => window.capabilityProbe.setMarker(2));
          await waitFor(forbidden, markerReceived(2), 'publisher-permissions-switched');
          await waitFor(
            allowed,
            (m) => m.connected && m.subscribed === 0,
            'publisher-permissions-old-blocked',
          );
          await proveBlocked(allowed, 'publisher-permissions-old-direct-denied');
          publisherPermissions.switched = true;
          await publisher.evaluate(() => window.capabilityProbe.restrictSubscribers([]));
          await waitFor(
            forbidden,
            (m) => m.connected && m.subscribed === 0,
            'publisher-permissions-retired',
          );
          await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
          await proveBlocked(forbidden, 'publisher-permissions-retired-direct-denied');
          publisherPermissions.retired = true;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !['MC01_MEASUREMENT_UNCONFIRMED', 'MC01_FORBIDDEN_MEDIA_OR_INVALID_CONTROL'].includes(
              error.message,
            )
          )
            throw error;
        } finally {
          await publisher.evaluate(() => window.capabilityProbe.restrictSubscribers([]));
          for (const identity of [a.identity, d.identity])
            await gateway.updateParticipant(
              roomName,
              identity,
              {
                permission: {
                  canSubscribe: false,
                  canPublish: true,
                  canPublishData: false,
                  canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
                },
              },
              context(true),
            );
        }
      }

      await allowed.evaluate(() => window.capabilityProbe.disconnect());
      await revoke(a.identity);
      await assertAbsent(a.identity);
      denied(
        'departed-original-token',
        await allowed.evaluate(() => window.capabilityProbe.reconnect('original')),
      );
      // Permission updates can themselves revoke the original token in the exploratory profile.
      evidence.departedTokenRejected = !publisherPermissionsAttempted;
      await forbidden.evaluate(() => window.capabilityProbe.clearRefresh());

      await gateway.updateParticipant(
        roomName,
        d.identity,
        {
          permission: {
            canPublish: false,
            canPublishData: false,
            canSubscribe: false,
            canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
          },
        },
        context(),
      );
      await waitFor(
        forbidden,
        (m) => m.connected && m.refreshReceived,
        'sdk-refreshed-token-received',
      );
      await revoke(d.identity);
      await assertAbsent(d.identity);
      denied(
        'sdk-refreshed-token',
        await forbidden.evaluate(() => window.capabilityProbe.reconnect('refreshed')),
      );
      evidence.refreshedTokenRejected = true;

      // Start just after a second boundary so this explicit request can exercise equal nbf seconds.
      await sleep(1010 - (Date.now() % 1000));
      const u = await mint();
      const revokeSecond = await revoke(u.identity);
      evidence.sameSecondRevocation = u.issuedSecond === revokeSecond;
      await assertAbsent(u.identity);
      denied(
        'never-joined-token',
        await unused.evaluate(({ url, token }) => window.capabilityProbe.connect(url, token), {
          url: config.wsUrl,
          token: u.token,
        }),
      );
      evidence.neverJoinedTokenRejected = true;
      const c = await mint();
      connected(
        await control.evaluate(({ url, token }) => window.capabilityProbe.connect(url, token), {
          url: config.wsUrl,
          token: c.token,
        }),
      );
      evidence.freshConnectionControl = true;
      if (failure === 'MC01_UNCONFIRMED') failure = 'MC01_MISSING_PROOF';
    } catch (error) {
      // SDK/Playwright exceptions may contain credentials; persist only this allowlisted category.
      if (error instanceof Error && /^MC01_[A-Z_]+$/.test(error.message)) failure = error.message;
    } finally {
      clearTimeout(watchdog);
      cleaning = true;
      cleanupDeadline = Math.min(
        finalDeadline,
        performance.now() + preflight.cleanupAllowanceSeconds * 1000,
      );
      cleanupWatchdog = setTimeout(abortBrowser, Math.max(1, cleanupDeadline - performance.now()));
      try {
        await browser?.close();
      } catch {
        localCleanupConfirmed = false;
        failure = 'MC01_BROWSER_CLEANUP_UNCONFIRMED';
      }
      try {
        if (roomAttempted) {
          const allIdentitiesConfirmed = await confirmIdentityCleanup(
            identities,
            async (identity) => {
              if (!revoked.has(identity)) await revoke(identity);
              await assertAbsent(identity);
            },
          );
          const rooms = await gateway.listRooms([roomName], context(true));
          if (allIdentitiesConfirmed && rooms.some((room) => room.name === roomName))
            await gateway.deleteRoom(roomName, context(true));
          const remains = (await gateway.listRooms([roomName], context(true))).some(
            (room) => room.name === roomName,
          );
          evidence.cleanupConfirmed = allIdentitiesConfirmed && localCleanupConfirmed && !remains;
          if (!allIdentitiesConfirmed) failure = 'MC01_IDENTITY_CLEANUP_UNCONFIRMED';
          if (remains) failure = 'MC01_ROOM_REMAINS';
        }
      } catch {
        evidence.cleanupConfirmed = false;
        failure = 'MC01_CLOUD_CLEANUP_UNCONFIRMED';
      }
      apiBudget.close();
      try {
        await vite?.close();
      } catch {
        failure = 'MC01_LOCAL_CLEANUP_UNCONFIRMED';
        evidence.cleanupConfirmed = false;
      }
      clearTimeout(cleanupWatchdog);
    }
    const report = capabilityReport(preflight, roomName, evidence, Date.now(), publisherMode);
    const directory = resolve(root, preflight.evidenceDir);
    await writeFile(
      resolve(directory, 'capability-evidence.json'),
      JSON.stringify(
        {
          case: 'MC-01',
          subscriptionMode: publisherMode ? 'publisher-permissions' : 'server-controlled',
          sourceCommit: preflight.sourceCommit,
          lockfileHash: preflight.lockfileHash,
          roomName,
          identities: [...identities],
          evidence,
          publisherPermissions,
          samples,
          denials,
          observations,
          calls,
          durationMs: Math.ceil(performance.now() - start),
          outcome: report.status,
          failure: report.status === 'SUPPORTED' ? null : failure,
        },
        null,
        2,
      ) + '\n',
    );
    // Evidence output only. F explicitly reviews and promotes it to OPS_DATA_DIR; never auto-enable production.
    await writeFile(
      resolve(directory, 'capability-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    if (report.status !== 'SUPPORTED') throw new Error(`MC01_BLOCKED:${failure}`);
  },
  caseTimeoutMs(preflight) + 10_000,
);
