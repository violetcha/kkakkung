import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { createServer, type ViteDevServer } from 'vite';
import { it } from 'vitest';
import { caseTimeoutMs, requireCloudPreflight } from '../../../tests/cloud/CloudPreflight.js';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { ownedMediaRooms, ownedMediaTargets } from '../../src/operations/SplitMediaOwnership.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { areRevokedMediaTargetsAbsent } from '../../src/media/RevokedMediaAbsence.js';
import {
  GatewayError,
  LiveKitGateway,
  type GatewayObservation,
} from '../../src/media/LiveKitGateway.js';
import { validateCapabilityPlan } from './cloud/capability-evidence.js';
import {
  UNJOINED_REVOCATION_CHECKS,
  unjoinedRevocationVerdict,
  type UnjoinedRevocationEvidence,
} from './cloud/unjoined-revocation-evidence.js';
import type { TrustedMediaFrame } from '../../src/media/types.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const preflight = requireCloudPreflight('MC-PUBLIC-03', process.env, Date.now(), root);
const config = validateCapabilityPlan(preflight, process.env);
if (
  !preflight.namespace.startsWith('qa-public-') ||
  preflight.maxRooms !== 3 ||
  preflight.maxParticipants !== 8
)
  throw new Error('UNJOINED_PROBE_REQUIRES_THREE_ROOMS_EIGHT_PARTICIPANT_RESERVATION');
if (process.env.DEBUG || process.env.PWDEBUG)
  throw new Error('UNJOINED_PROBE_DISABLE_TOKEN_TRACING');
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !==
    preflight.sourceCommit ||
  createHash('sha256')
    .update(await readFile(resolve(root, 'pnpm-lock.yaml')))
    .digest('hex') !== preflight.lockfileHash ||
  execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
)
  throw new Error('UNJOINED_PROBE_REQUIRES_CLEAN_APPROVED_SOURCE');

it(
  'MC-PUBLIC-03 revokes unjoined split identities before room creation and after recreation',
  async () => {
    const evidence = Object.fromEntries(
      UNJOINED_REVOCATION_CHECKS.map((key) => [key, false]),
    ) as UnjoinedRevocationEvidence;
    const observations: GatewayObservation[] = [];
    const samples: { phase: string; target: number; outcome: string; status: number | null }[] = [];
    const missingRoomInventories: {
      roomIndex: number;
      outcome: 'empty' | 'not_found' | 'unexpected';
    }[] = [];
    const calls = { normal: 0, cleanup: 0 };
    const startedAt = performance.now();
    const deadline = startedAt + preflight.maxDurationSeconds * 1000;
    const finalDeadline = deadline + preflight.cleanupAllowanceSeconds * 1000;
    let cleanupDeadline = finalDeadline;
    let cleaning = false;
    let failure: string | null = null;
    let browser: Browser | undefined;
    let vite: ViteDevServer | undefined;
    let minted = 0;
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
        throw new Error('UNJOINED_PROBE_DEADLINE');
    };
    const context = () => {
      guard();
      const priority = cleaning ? 'cleanup' : 'normal';
      if (++calls[priority] > (cleaning ? 30 : 40)) throw new Error('UNJOINED_PROBE_API_LIMIT');
      return {
        requestId: randomUUID(),
        priority,
        deadlineMs: Math.min(performance.now() + 10_000, cleaning ? cleanupDeadline : deadline),
        beforeDispatch: () => {
          guard();
          return true;
        },
      } as const;
    };
    // Use the real allocation/ownership producer, but diagnostic signing. No invented capability
    // is loaded into GrantIssuer/MediaCoordinator to make this bootstrap observation succeed.
    const registry = new MediaGenerationRegistry(preflight.namespace, true, 'split');
    const matchId = randomUUID();
    const instanceId = randomUUID();
    const frame: TrustedMediaFrame = {
      matchId,
      mediaInstanceId: instanceId,
      instancePurpose: 'practice',
      frameRevision: 1,
      tick: 1,
      phase: 'TEAM_PRACTICE',
      topology: { topologyVersion: 'qa-isolated', width: 1, height: 1, walkable: [true] },
      participants: ['source', 'receiver'].map((playerId) => ({
        playerId,
        role: 'runner',
        status: 'ACTIVE',
        cell: { x: 0, y: 0 },
        dir: 0,
        action: null,
      })),
      events: [],
    };
    registry.openMatch(matchId);
    if (!registry.observe(frame)) throw new Error('UNJOINED_PROBE_SCOPE');
    const generation = registry.allocate(
      {
        requestId: randomUUID(),
        matchId,
        playerId: 'source',
        mediaInstanceId: instanceId,
        purpose: 'practice',
        expectedPreviousGeneration: null,
      },
      Date.now(),
    );
    const targets = ownedMediaTargets(generation);
    const rooms = [...ownedMediaRooms(generation)];
    const cleanupTargets = [...targets];
    evidence.productOwnershipUsed = targets.length === 4 && rooms.length === 3;
    const scoped = (roomName: string) => {
      if (!rooms.includes(roomName)) throw new Error('UNJOINED_PROBE_SCOPE');
    };
    const absent = async (roomName: string, identity: string) => {
      scoped(roomName);
      try {
        await gateway.getParticipant(roomName, identity, context());
        return false;
      } catch (error) {
        if (error instanceof GatewayError && error.code === 'not_found' && !error.outcomeUnknown)
          return true;
        throw error;
      }
    };
    const remove = async (roomName: string, identity: string) => {
      scoped(roomName);
      // A not_found remove response is deliberately NOT accepted as an acknowledged cutoff.
      await gateway.removeParticipant(
        roomName,
        identity,
        { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 5) },
        context(),
      );
    };
    const mint = async (roomName: string, identity: string, face: boolean) => {
      scoped(roomName);
      guard();
      if (++minted > 6) throw new Error('UNJOINED_PROBE_TOKEN_LIMIT');
      const token = new AccessToken(config.apiKey, config.apiSecret, { identity, ttl: 300 });
      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: !face,
        canPublishSources: [face ? TrackSource.CAMERA : TrackSource.MICROPHONE],
        canPublishData: false,
        roomAdmin: false,
        roomRecord: false,
        roomCreate: false,
        roomList: false,
      });
      return token.toJwt();
    };
    const deleteRoom = async (roomName: string) => {
      scoped(roomName);
      try {
        await gateway.deleteRoom(roomName, context());
      } catch (error) {
        if (!(error instanceof GatewayError) || error.code !== 'not_found' || error.outcomeUnknown)
          throw error;
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
        cacheDir: resolve(root, '.local/qa/unjoined-probe-vite-cache'),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0 },
      });
      await vite.listen();
      const local = vite.resolvedUrls?.local[0];
      if (!local) throw new Error('UNJOINED_PROBE_LOCAL_UNAVAILABLE');
      browser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=no-user-gesture-required'],
      });
      const page = await browser.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(local + 'capability.html');
      await page.waitForFunction(() => !!window.capabilityProbe);
      // Tokens for clone destinations are diagnostic adversarial controls only; the product
      // never gives such tokens to a browser. They verify the per-room identity cutoff.
      const tokens = await Promise.all(
        targets.map((t) =>
          mint(t.roomName, t.identity, t.identity === generation.splitOwnership!.faceIdentity),
        ),
      );
      evidence.roomsInitiallyAbsent = (await gateway.listRooms(rooms, context())).length === 0;
      if (!evidence.roomsInitiallyAbsent) throw new Error('UNJOINED_PROBE_ROOM_COLLISION');
      for (const target of targets) await remove(target.roomName, target.identity);
      evidence.missingRemoveAcknowledged = true;
      evidence.missingParticipantsAbsent = (
        await Promise.all(targets.map((t) => absent(t.roomName, t.identity)))
      ).every(Boolean);
      for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
        try {
          const participants = await gateway.listParticipants(rooms[roomIndex]!, context());
          missingRoomInventories.push({
            roomIndex,
            outcome: participants.length === 0 ? 'empty' : 'unexpected',
          });
        } catch (error) {
          if (
            !(error instanceof GatewayError) ||
            error.code !== 'not_found' ||
            error.outcomeUnknown
          )
            throw error;
          missingRoomInventories.push({ roomIndex, outcome: 'not_found' });
        }
      }
      // Use the same product absence consumer after every explicit removal has acknowledged.
      evidence.productAbsenceConfirmed = await areRevokedMediaTargetsAbsent(
        targets,
        gateway,
        context,
      );
      const rejected = async (phase: string) => {
        let all = true;
        for (let i = 0; i < tokens.length; i++) {
          guard();
          const result = await page.evaluate(
            ({ url, token }) => window.capabilityProbe.connect(url, token),
            { url: config.wsUrl, token: tokens[i]! },
          );
          samples.push({ phase, target: i, ...result });
          all &&= result.outcome === 'denied' && (result.status === 401 || result.status === 403);
          await page.evaluate(() => window.capabilityProbe.disconnect());
        }
        return all;
      };
      evidence.neverJoinedTokensRejected = await rejected('missing-room');
      // Independent fresh identities verify that network failure or an unusable minimum grant
      // did not produce the negative result. The old identities are never reminted.
      let controls = true;
      for (const target of targets.slice(0, 2)) {
        const identity = `${preflight.namespace}--${registry.serverEpoch}--${randomUUID()}`;
        cleanupTargets.push({ roomName: target.roomName, identity });
        const token = await mint(
          target.roomName,
          identity,
          target.identity === generation.splitOwnership!.faceIdentity,
        );
        const result = await page.evaluate(
          ({ url, token }) => window.capabilityProbe.connect(url, token),
          { url: config.wsUrl, token },
        );
        samples.push({ phase: 'fresh-control', target: targets.indexOf(target), ...result });
        controls &&= result.outcome === 'connected';
        await page.evaluate(() => window.capabilityProbe.disconnect());
      }
      evidence.freshControlsConnected = controls;
      for (const name of rooms)
        await gateway.createRoom({ name, emptyTimeout: 300, departureTimeout: 300 }, context());
      if ((await gateway.listRooms(rooms, context())).length !== rooms.length)
        throw new Error('UNJOINED_PROBE_CREATION_UNCONFIRMED');
      evidence.creationPreservedCutoffs = await rejected('created-room');
      for (const name of rooms) await deleteRoom(name);
      if ((await gateway.listRooms(rooms, context())).length !== 0)
        throw new Error('UNJOINED_PROBE_DELETION_UNCONFIRMED');
      for (const name of rooms)
        await gateway.createRoom({ name, emptyTimeout: 300, departureTimeout: 300 }, context());
      if ((await gateway.listRooms(rooms, context())).length !== rooms.length)
        throw new Error('UNJOINED_PROBE_RECREATION_UNCONFIRMED');
      evidence.recreationPreservedCutoffs = await rejected('recreated-room');
    } catch (error) {
      failure =
        error instanceof GatewayError
          ? `GATEWAY_${error.code.toUpperCase()}`
          : error instanceof Error && /^UNJOINED_PROBE_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'UNJOINED_PROBE_UNCONFIRMED';
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
      for (const target of cleanupTargets) {
        try {
          await remove(target.roomName, target.identity);
          if (!(await absent(target.roomName, target.identity))) confirmed = false;
        } catch {
          confirmed = false;
        }
      }
      for (const name of rooms) {
        try {
          await deleteRoom(name);
        } catch {
          confirmed = false;
        }
      }
      try {
        if ((await gateway.listRooms(rooms, context())).length !== 0) confirmed = false;
      } catch {
        confirmed = false;
      }
      evidence.cleanupConfirmed = confirmed;
      try {
        await vite?.close();
      } catch {
        evidence.cleanupConfirmed = false;
      }
      clearTimeout(cleanupWatchdog);
      budget.close();
      registry.close();
      const verdict = unjoinedRevocationVerdict(evidence);
      await writeFile(
        resolve(root, preflight.evidenceDir, 'unjoined-revocation-evidence.json'),
        JSON.stringify(
          {
            version: 1,
            caseId: 'MC-PUBLIC-03',
            sourceCommit: preflight.sourceCommit,
            lockfileHash: preflight.lockfileHash,
            projectAlias: preflight.projectAlias,
            namespace: preflight.namespace,
            testedAtEpochMs: Date.now(),
            durationMs: performance.now() - startedAt,
            evidence,
            verdict,
            failure,
            calls,
            samples,
            observations,
            missingRoomInventories,
            rawInventoriesAreEmpty:
              missingRoomInventories.length === rooms.length &&
              missingRoomInventories.every((value) => value.outcome === 'empty'),
            currentProductListAbsenceCompatible: evidence.productAbsenceConfirmed,
            productAbsenceUsed: true,
            realDevices: false,
            mediaPublished: false,
            diagnosticSigner: true,
            productIssuerUsed: false,
            productCoordinatorUsed: false,
          },
          null,
          2,
        ) + '\n',
      );
    }
    if (!unjoinedRevocationVerdict(evidence).emptyRoomRevocationVerified || failure)
      throw new Error(failure ?? 'UNJOINED_PROBE_ASSERTION_FAILED');
  },
  caseTimeoutMs(preflight),
);
