import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
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
import {
  publicAuthorityVerdict,
  type PublicAuthorityEvidence,
} from './cloud/public-authority-evidence.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const preflight = requireCloudPreflight('MC-PUBLIC-01', process.env, Date.now(), root);
const config = validateCapabilityPlan(preflight, process.env);
if (
  !preflight.namespace.startsWith('qa-public-') ||
  preflight.maxRooms !== 3 ||
  preflight.maxParticipants !== 8
)
  throw new Error('PUBLIC_PROBE_REQUIRES_ISOLATED_THREE_ROOMS_EIGHT_PARTICIPANT_RESERVATION');
if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('PUBLIC_PROBE_DISABLE_TOKEN_TRACING');
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !==
    preflight.sourceCommit ||
  createHash('sha256')
    .update(await readFile(resolve(root, 'pnpm-lock.yaml')))
    .digest('hex') !== preflight.lockfileHash ||
  execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
)
  throw new Error('PUBLIC_PROBE_REQUIRES_CLEAN_APPROVED_SOURCE');

it(
  'MC-PUBLIC-01 measures hostile publisher control and isolated Cloud forwarding without promoting production',
  async () => {
    const evidence: PublicAuthorityEvidence = {
      minimumGrant: { allowedFresh: false, directBlocked: false, removedBlocked: false },
      publisherPermissions: { allowedFresh: false, directBlocked: false, bypassObserved: false },
      forwarding: {
        api: 'not-attempted',
        allowedFresh: false,
        directBlocked: false,
        removedBlocked: false,
        forbiddenPositiveControl: false,
      },
      cleanupConfirmed: false,
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
    let forwardFailure: string | null = null;
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
    // Test-only SDK method outside the product adapter. Same budget, finite transport wait, no failover.
    const forwardClient = new RoomServiceClient(config.httpUrl, config.apiKey, config.apiSecret, {
      requestTimeout: 10,
      failover: false,
    });
    const guard = () => {
      if (
        performance.now() >= (cleaning ? cleanupDeadline : deadline) ||
        (!cleaning && Date.now() >= preflight.expiresAtEpochMs)
      )
        throw new Error('PUBLIC_PROBE_DEADLINE');
    };
    const context = (cleanup = false) => {
      guard();
      const priority = cleanup ? 'cleanup' : 'normal';
      if (++calls[priority] > (cleanup ? 30 : 40)) throw new Error('PUBLIC_PROBE_API_LIMIT');
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
      if (rooms.length >= 3) throw new Error('PUBLIC_PROBE_ROOM_LIMIT');
      const name = preflight.namespace + '--' + randomUUID();
      rooms.push(name);
      await gateway.createRoom(
        { name, maxParticipants: 5, emptyTimeout: 30, departureTimeout: 30 },
        context(),
      );
      return name;
    };
    const mint = async (room: string, canSubscribe: boolean) => {
      guard();
      if (++issuedIdentities > 5) throw new Error('PUBLIC_PROBE_IDENTITY_LIMIT');
      const identity = preflight.namespace + '--' + randomUUID();
      remember(room, identity);
      const token = new AccessToken(config.apiKey, config.apiSecret, { identity, ttl: 300 });
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe,
        canPublishData: false,
        canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
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
      if (result.outcome !== 'connected') throw new Error('PUBLIC_PROBE_CONNECT_UNCONFIRMED');
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
    const blocked = async (page: Page, phase: string) => {
      for (let i = 0; i < 20; i++) {
        const m = await measure(page);
        if (
          !m.connected ||
          m.subscribed !== 0 ||
          m.marker !== null ||
          m.frequency !== null ||
          m.bytesReceived !== 0
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
      const ctx = context();
      await budget.dispatch({
        ...ctx,
        method: 'forwardParticipant',
        target: createHash('sha256')
          .update(from + identity + to)
          .digest('hex'),
        kind: 'grant',
        run: () => forwardClient.forwardParticipant(from, identity, to),
      });
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
        cacheDir: resolve(root, '.local/qa/public-probe-vite-cache'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0 },
      });
      await vite.listen();
      const local = vite.resolvedUrls?.local[0];
      if (!local) throw new Error('PUBLIC_PROBE_LOCAL_UNAVAILABLE');
      browser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=no-user-gesture-required'],
      });
      const pages: Page[] = [];
      for (let i = 0; i < 3; i++) {
        const page = await browser.newPage();
        page.setDefaultTimeout(8000);
        await page.goto(local + 'capability.html');
        await page.waitForFunction(() => !!window.capabilityProbe);
        pages.push(page);
      }
      const [publisher, allowed, forbidden] = pages as [Page, Page, Page];
      const shared = await createRoom();
      const p = await mint(shared, false);
      const a = await mint(shared, false);
      const d = await mint(shared, false);
      await connect(publisher, p.token);
      await connect(allowed, a.token);
      await connect(forbidden, d.token);
      const tracks = await publisher.evaluate(() => window.capabilityProbe.publish());
      if (tracks.length !== 2 || tracks.some((sid) => !sid))
        throw new Error('PUBLIC_PROBE_PUBLISH_UNCONFIRMED');
      await gateway.updateSubscriptions(shared, a.identity, tracks, true, context());
      evidence.minimumGrant.allowedFresh = await waitFor(
        allowed,
        received(1),
        'minimum-server-allow',
      );
      if (!(await waitFor(forbidden, (m) => m.publications === 2, 'minimum-tracks-visible')))
        throw new Error('PUBLIC_PROBE_TRACKS_UNCONFIRMED');
      await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
      evidence.minimumGrant.directBlocked = await blocked(forbidden, 'minimum-direct-blocked');
      if (evidence.minimumGrant.allowedFresh) {
        await gateway.updateSubscriptions(shared, a.identity, tracks, false, context(true));
        await allowed.evaluate(() => window.capabilityProbe.directSubscribe());
        await publisher.evaluate(() => window.capabilityProbe.setMarker(2));
        await waitFor(allowed, (m) => m.subscribed === 0, 'minimum-remove');
        evidence.minimumGrant.removedBlocked = await blocked(allowed, 'minimum-remove-blocked');
      }

      await publisher.evaluate(
        (identity) => window.capabilityProbe.restrictSubscribers([identity]),
        a.identity,
      );
      for (const identity of [a.identity, d.identity])
        await gateway.updateParticipant(
          shared,
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
      await allowed.evaluate(() => window.capabilityProbe.directSubscribe());
      await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
      await publisher.evaluate(() => window.capabilityProbe.setMarker(1));
      evidence.publisherPermissions.allowedFresh = await waitFor(
        allowed,
        received(1),
        'compliant-publisher-allow',
      );
      evidence.publisherPermissions.directBlocked = await blocked(
        forbidden,
        'compliant-publisher-deny',
      );
      await publisher.evaluate(
        (identities) => window.capabilityProbe.restrictSubscribers(identities),
        [a.identity, d.identity],
      );
      await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
      await publisher.evaluate(() => window.capabilityProbe.setMarker(2));
      evidence.publisherPermissions.bypassObserved = await waitFor(
        forbidden,
        received(2),
        'modified-publisher-direct-bypass',
      );

      // Each receiver can join only its own room; source-room tokens are never delivered to them.
      await allowed.evaluate(() => window.capabilityProbe.disconnect());
      await forbidden.evaluate(() => window.capabilityProbe.disconnect());
      await revoke(shared, a.identity);
      await revoke(shared, d.identity);
      const destination = await createRoom();
      const deniedRoom = await createRoom();
      const a2 = await mint(destination, true);
      const d2 = await mint(deniedRoom, true);
      await connect(allowed, a2.token);
      await connect(forbidden, d2.token);
      // Hostile source permits both receivers. It still cannot create the cross-room forwarding.
      await publisher.evaluate(
        (identities) => window.capabilityProbe.restrictSubscribers(identities),
        [a2.identity, d2.identity],
      );
      try {
        await forward(shared, p.identity, destination);
        evidence.forwarding.api = 'accepted';
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        evidence.forwarding.api = [
          'permission_denied',
          'unimplemented',
          'failed_precondition',
        ].includes(String(code))
          ? 'unsupported'
          : 'unconfirmed';
        forwardFailure = evidence.forwarding.api;
      }
      if (evidence.forwarding.api === 'accepted') {
        await waitFor(allowed, (m) => m.publications === 2, 'forward-tracks-visible');
        await allowed.evaluate(() => window.capabilityProbe.directSubscribe());
        await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
        await publisher.evaluate(() => window.capabilityProbe.setMarker(3));
        evidence.forwarding.allowedFresh = await waitFor(allowed, received(3), 'forward-allowed');
        evidence.forwarding.directBlocked = await blocked(forbidden, 'forward-other-room-denied');
        await revoke(destination, p.identity);
        await waitFor(allowed, (m) => m.subscribed === 0, 'forward-removed');
        await allowed.evaluate(() => window.capabilityProbe.directSubscribe());
        await publisher.evaluate(() => window.capabilityProbe.setMarker(1));
        evidence.forwarding.removedBlocked = await blocked(allowed, 'forward-removed-blocked');
        await forward(shared, p.identity, deniedRoom);
        await waitFor(forbidden, (m) => m.publications === 2, 'forward-positive-visible');
        await forbidden.evaluate(() => window.capabilityProbe.directSubscribe());
        await publisher.evaluate(() => window.capabilityProbe.setMarker(2));
        evidence.forwarding.forbiddenPositiveControl = await waitFor(
          forbidden,
          received(2),
          'forward-denied-receiver-positive',
        );
      }
    } catch (error) {
      failure =
        error instanceof Error && /^PUBLIC_PROBE_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'PUBLIC_PROBE_UNCONFIRMED';
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
    const verdict = publicAuthorityVerdict(evidence);
    await writeFile(
      resolve(root, preflight.evidenceDir, 'public-authority-evidence.json'),
      JSON.stringify(
        {
          case: 'MC-PUBLIC-01',
          sourceCommit: preflight.sourceCommit,
          lockfileHash: preflight.lockfileHash,
          namespace: preflight.namespace,
          testedAtEpochMs: Date.now(),
          durationMs: Math.ceil(performance.now() - start),
          evidence,
          verdict,
          failure,
          forwardFailure,
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
    if (failure || !verdict.candidateAvailable)
      throw new Error(failure ?? 'PUBLIC_PROBE_NO_VERIFIED_CANDIDATE');
  },
  caseTimeoutMs(preflight) + 10_000,
);
