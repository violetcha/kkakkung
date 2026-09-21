import { randomUUID } from 'node:crypto';
import { validateSmokeTarget } from '../../scripts/lib/smoke-target.mjs';
import { setTimeout as pause } from 'node:timers/promises';
import { Client, type Room } from '@colyseus/sdk';
import {
  MEDIA_ROUTES,
  mediaGrantSchema,
  sessionResponseSchema,
} from '@kkakkung/protocol/game-messages';
import { ABORT_REASONS, type PublicMatchState } from '@kkakkung/protocol/game-schema';
import { PRODUCT_PROTOCOL_VERSION, PRODUCT_ROOM_NAME } from '@kkakkung/protocol/version';
import { bindProductRoom } from '../../apps/web/src/app/product-runtime';
import { productRoomPort } from '../../apps/web/src/features/room/product-session';
import { markConsented } from '../../apps/web/src/features/room/consent';
import {
  createDeploymentInteractionFactory,
  type DeploymentMediaProbe,
} from './DeploymentInteraction.js';
import { validateDeploymentSmokePlan } from './DeploymentSmokePlan.js';
import { DeploymentPracticeApproach } from './DeploymentPracticeApproach.js';
import type { CloudPreflight } from './CloudPreflight.js';

export type DeploymentSmokeReport = {
  evidenceScope: 'SYNTHETIC_CLOUD_DEPLOYMENT_SMOKE' | 'LOCAL_CONTRACT_ONLY';
  status: 'PASS' | 'FAIL';
  failureCode: string | null;
  failureObservation?: {
    condition: string | null;
    media?: {
      forbiddenReceived: number;
      forbiddenVideo: number;
      forbiddenAudio: number;
      bindingMissing: number;
      audioPolicyDenied: number;
    }[];
    clients: {
      phase: string | null;
      serverTick: number | null;
      startTick: number | null;
      abortReason: string | null;
      runtimeError: boolean;
      connectionLost: boolean;
    }[];
  };
  participants: number;
  phaseCoverage: string[];
  commandsSent: number;
  commandsApplied: number;
  gameInputsApplied: number;
  mediaRooms: { practice: number; game: number };
  received: {
    practiceVideo: boolean;
    practiceAudio: boolean;
    gameVideo: boolean;
    gameAudio: boolean;
  };
  cleanup: { clientsClosed: number; drainConfirmed: boolean; resumed: boolean };
  durationMs: number;
};

export type DeploymentSmokeOptions = {
  mode: 'cloud' | 'local-contract';
  baseUrl: string;
  cookie: string;
  publicBaseUrl?: string;
  internalToken?: string;
  opsToken: string;
  origin: string;
  preflight: CloudPreflight;
  deviceManifest: unknown;
  /** Includes browser preparation in the approved run budget. */
  startedAtEpochMs?: number;
  createProbe(playerId: string): Promise<DeploymentMediaProbe>;
  /** Only a local server fixture may advance ticks. Cloud always plays the real 180s round. */
  advanceLocalRound?: (roomCode: string) => Promise<void>;
};

/** Six actual C runtimes, B HTTP/WS and E grant/report/retirement contracts. No debug API. */
export async function runDeploymentSmoke(
  options: DeploymentSmokeOptions,
): Promise<DeploymentSmokeReport> {
  const started = options.startedAtEpochMs ?? Date.now();
  if (!Number.isSafeInteger(started) || started > Date.now()) throw new Error('DP06_INVALID_START');
  validateDeploymentSmokePlan(options.preflight, options.deviceManifest, started);
  if (options.mode === 'cloud') {
    validateSmokeTarget(options.baseUrl, options.publicBaseUrl ?? '', options.internalToken ?? '');
    if (options.origin !== options.publicBaseUrl || options.cookie || options.advanceLocalRound)
      throw new Error('DP06_CLOUD_TARGET_OR_EXECUTION_POLICY_INVALID');
  }
  if (!options.opsToken) throw new Error('DP06_OPERATOR_TOKEN_MISSING');
  // 합성 참가자들도 실제 web 런타임을 쓴다. 그 런타임은 동의 전에는 장치에 닿지 않으므로
  // (S15P21C204-292) 동의한 사람 자리에 선다고 선언한다. 여기에는 브라우저 저장소가 없다.
  markConsented();
  const report: DeploymentSmokeReport = {
    evidenceScope:
      options.mode === 'cloud' ? 'SYNTHETIC_CLOUD_DEPLOYMENT_SMOKE' : 'LOCAL_CONTRACT_ONLY',
    status: 'FAIL',
    failureCode: null,
    participants: 0,
    phaseCoverage: [],
    commandsSent: 0,
    commandsApplied: 0,
    gameInputsApplied: 0,
    mediaRooms: { practice: 0, game: 0 },
    received: { practiceVideo: false, practiceAudio: false, gameVideo: false, gameAudio: false },
    cleanup: { clientsClosed: 0, drainConfirmed: false, resumed: false },
    durationMs: 0,
  };
  const until =
    started +
    Math.min(
      options.preflight.maxDurationSeconds * 1000,
      options.mode === 'local-contract' ? 120_000 : Infinity,
    );
  const cleanupUntil = until + options.preflight.cleanupAllowanceSeconds * 1000;
  const phases = new Set<string>();
  const players: { runtime: ReturnType<typeof bindProductRoom>; probe: DeploymentMediaProbe }[] =
    [];
  const joinedRooms: Room<unknown, PublicMatchState>[] = [];
  const createdProbes: DeploymentMediaProbe[] = [];
  const gameInputs = new Set<string>();
  const practiceApproach = new DeploymentPracticeApproach(6);
  const cloudRooms = { practice: new Set<string>(), game: new Set<string>() };
  let timer: ReturnType<typeof setInterval> | undefined;
  let stage = 'DP06_INITIALIZATION_FAILED';
  let mediaFailure = false;
  let createdSession = false;
  let cleaning = false;
  let mediaFailureObservation: NonNullable<DeploymentSmokeReport['failureObservation']>['media'];
  const timeLimit = () => (cleaning ? cleanupUntil : until);
  const bounded = async <T>(work: Promise<T>, capMs = 15_000): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('DP06_IO_DEADLINE')),
            Math.max(1, Math.min(capMs, timeLimit() - Date.now())),
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input);
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('DP06_INVALID_API_PATH');
    const remaining = timeLimit() - Date.now();
    if (remaining <= 0) throw new Error('DP06_DEADLINE');
    const headers = new Headers(init?.headers);
    headers.set('origin', options.origin);
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.internalToken) headers.set('x-kkakkung-smoke-key', options.internalToken);
    const response = await fetch(options.baseUrl + path, {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.min(10_000, remaining)),
    });
    if (path === MEDIA_ROUTES.grants && response.ok) {
      const grant = mediaGrantSchema.parse(await response.clone().json());
      const request = JSON.parse(String(init?.body)) as { purpose: 'practice' | 'game' };
      cloudRooms[request.purpose].add(grant.roomName);
      report.mediaRooms[request.purpose] = cloudRooms[request.purpose].size;
      if (cloudRooms.practice.size > 2 || cloudRooms.game.size > 1)
        throw new Error('DP06_CLOUD_ROOM_TOPOLOGY_EXCEEDED');
    }
    return response;
  };
  const operator = {
    authorization: `Bearer ${options.opsToken}`,
    'content-type': 'application/json',
  };
  const api = async (path: string, init?: RequestInit) => {
    const response = await fetcher(path, init);
    if (!response.ok) throw new Error('DP06_API_REJECTED');
    return response.json() as Promise<Record<string, unknown>>;
  };
  const wait = async (condition: () => boolean | Promise<boolean>, deadline = until) => {
    while (!(await condition())) {
      if (Date.now() >= deadline || (!cleaning && mediaFailure))
        throw new Error('DP06_CONDITION_TIMEOUT');
      await pause(100);
    }
  };
  const command = async (action: 'drain' | 'resume') => {
    const requestId = randomUUID();
    const response = await fetcher('/api/operations/commands', {
      method: 'POST',
      headers: operator,
      body: JSON.stringify({ requestId, action }),
    });
    if (response.status !== 202) throw new Error('DP06_OPERATION_REJECTED');
    await wait(async () => {
      const value = await api(`/api/operations/commands/${requestId}`, { headers: operator });
      if (value.requestId !== requestId || value.action !== action || value.status === 'failed')
        throw new Error('DP06_OPERATION_FAILED');
      return value.status === 'succeeded';
    }, timeLimit());
  };
  const status = () => api('/api/operations/status', { headers: operator });
  const healthy = (value: Record<string, unknown>, admission: string) =>
    value.readiness === 'READY' && value.admission === admission && value.unresolvedCount === 0;
  const checkCleanup = (condition: boolean) => {
    if (!condition) throw new Error('DP06_CLEANUP_UNCONFIRMED');
  };
  const snapshot = () => players.map((player) => player.runtime.getSnapshot());
  const waitPhase = (phase: string) =>
    wait(() => {
      const all = snapshot();
      if (all.some((value) => value.error || value.lost || value.round?.phase === 'ABORTED'))
        throw new Error('DP06_PRODUCT_RUNTIME_FAILED');
      return all.length === 6 && all.every((value) => value.round?.phase === phase);
    });
  const move = (index: number, round: number) => {
    const player = players[index]!;
    const moveId = player.runtime.send({ type: 'MOVE_INTENT', payload: { direction: 'forward' } });
    if (moveId) {
      report.commandsSent++;
      if (player.runtime.getSnapshot().round?.phase === 'PLAYING') gameInputs.add(moveId);
    }
    if (round % (5 + index) === 0) {
      const turnId = player.runtime.send({
        type: 'TURN',
        payload: { direction: (round + index) % 2 ? 'right' : 'left' },
      });
      if (turnId) {
        report.commandsSent++;
        if (player.runtime.getSnapshot().round?.phase === 'PLAYING') gameInputs.add(turnId);
      }
    }
  };
  const sampleMedia = async (purpose: 'practice' | 'game') => {
    const samples = await bounded(Promise.all(players.map((player) => player.probe.snapshot())));
    if (samples.some((sample) => sample.forbiddenReceived > 0)) {
      mediaFailureObservation = samples.map((sample) => ({
        forbiddenReceived: sample.forbiddenReceived,
        forbiddenVideo: sample.forbiddenByKind?.video ?? 0,
        forbiddenAudio: sample.forbiddenByKind?.audio ?? 0,
        bindingMissing: sample.forbiddenByReason?.binding ?? 0,
        audioPolicyDenied: sample.forbiddenByReason?.audioPolicy ?? 0,
      }));
      throw new Error('DP06_UNBOUND_MEDIA_RECEIVED');
    }
    const video = samples.some((sample) => sample.allowedReceived.video > 0);
    const audio = samples.some((sample) => sample.allowedReceived.audio > 0);
    if (purpose === 'practice') {
      report.received.practiceVideo ||= video;
      report.received.practiceAudio ||= audio;
    } else {
      report.received.gameVideo ||= video;
      report.received.gameAudio ||= audio;
    }
    return samples.every(
      (sample) =>
        sample.connected &&
        sample.localTracks.some((track) => track.kind === 'video') &&
        sample.localTracks.some((track) => track.kind === 'audio'),
    );
  };

  try {
    stage = 'DP06_ISOLATION_OR_READINESS_FAILED';
    if (options.mode === 'cloud') {
      const response = await fetch(options.publicBaseUrl + '/api/config', {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (![301, 302, 401, 403].includes(response.status)) throw new Error('DP06_ISOLATION');
      for (const headers of [new Headers(), new Headers({ 'x-kkakkung-smoke-key': 'invalid' })]) {
        const rejected = await fetch(options.baseUrl + '/api/config', {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        if (rejected.status !== 403) throw new Error('DP06_INTERNAL_AUTH_NOT_ENFORCED');
      }
    }
    const ready = await api('/health/ready');
    if (ready.state !== 'READY' || !healthy(await status(), 'OPEN'))
      throw new Error('DP06_NOT_READY');
    stage = 'DP06_SESSION_OR_JOIN_FAILED';
    const invitation = await api('/api/operations/invitations', {
      method: 'POST',
      headers: operator,
      body: JSON.stringify({
        scope: { allowCreate: true, roomCodes: [] },
        expiresAt: Date.now() + 60_000,
      }),
    });
    const sdk = new Client(options.baseUrl, {
      headers: {
        origin: options.origin,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.internalToken ? { 'x-kkakkung-smoke-key': options.internalToken } : {}),
      },
    });
    let roomCode: string | undefined;
    for (let index = 0; index < 6; index++) {
      const session = sessionResponseSchema.parse(
        await api('/api/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nickname: `DP06-${index + 1}`,
            inviteToken: invitation.inviteToken,
            createRoom: !roomCode,
            ...(roomCode ? { roomCode } : {}),
          }),
        }),
      );
      createdSession = true;
      roomCode = session.roomCode;
      const joining = sdk.joinOrCreate<PublicMatchState>(PRODUCT_ROOM_NAME, {
        token: session.sessionToken,
        roomCode,
        protocolVersion: PRODUCT_PROTOCOL_VERSION,
      });
      void joining.then(
        (room) => {
          joinedRooms.push(room);
          if (cleaning) void room.leave().catch(() => {});
        },
        () => {},
      );
      const room = await bounded(joining);
      const creating = options.createProbe(session.playerId);
      void creating.then(
        (probe) => {
          createdProbes.push(probe);
          if (cleaning) void probe.close().catch(() => {});
        },
        () => {},
      );
      const probe = await bounded(creating);
      const runtime = bindProductRoom(productRoomPort(room), session, {
        now: () => performance.now(),
        uuid: randomUUID,
        fetcher,
        interactionFactory: createDeploymentInteractionFactory(probe, {
          onFailure: () => {
            mediaFailure = true;
          },
        }),
        changed: (value) => {
          if (value.round) phases.add(value.round.phase);
        },
      });
      room.onMessage('command-outcome', (outcome: { result: string; requestId: string }) => {
        practiceApproach.acknowledge(outcome.requestId, outcome.result);
        if (outcome.result === 'applied') report.commandsApplied++;
        if (gameInputs.delete(outcome.requestId) && outcome.result === 'applied')
          report.gameInputsApplied++;
      });
      room.onMessage('*', () => {});
      players.push({ runtime, probe });
      report.participants++;
    }
    timer = setInterval(() => players.forEach((player) => player.runtime.poll()), 20);
    stage = 'DP06_DEVICE_OR_PRACTICE_FAILED';
    await waitPhase('DEVICE_CHECK');
    for (const player of players) {
      await bounded(player.runtime.startDevices(false));
      player.runtime.ready(true);
    }
    await waitPhase('TEAM_PRACTICE');
    stage = 'DP06_PRACTICE_MEDIA_UNCONFIRMED';
    let moves = 0;
    await wait(async () => {
      if (snapshot().some((s) => s.round?.phase !== 'TEAM_PRACTICE' || s.error))
        throw new Error('DP06_PRACTICE_ENDED_EARLY');
      const published = await sampleMedia('practice');
      report.commandsSent += practiceApproach.advance(published, (index) =>
        players[index]!.runtime.send({ type: 'MOVE_INTENT', payload: { direction: 'forward' } }),
      );
      return published && report.received.practiceVideo && report.received.practiceAudio;
    });
    players.forEach((player) =>
      player.runtime.send({ type: 'PRACTICE_READY', payload: { ready: true } }),
    );
    stage = 'DP06_GAME_LOADING_FAILED';
    await waitPhase('PLAYING');
    const first = snapshot()[0]!.round!;
    if (first.deadlineTick! - first.startTick! !== 3600) throw new Error('DP06_ROUND_CONTRACT');
    stage = 'DP06_GAME_MEDIA_OR_RESULT_FAILED';
    let advanced = false;
    while (!snapshot().every((s) => s.round?.phase === 'RESULT')) {
      if (
        Date.now() >= until ||
        mediaFailure ||
        snapshot().some((s) => s.error || s.lost || s.round?.phase === 'ABORTED')
      )
        throw new Error('DP06_GAME_FAILED');
      players.forEach((_, index) => move(index, moves));
      moves++;
      await sampleMedia('game');
      if (
        options.advanceLocalRound &&
        !advanced &&
        report.received.gameVideo &&
        report.received.gameAudio &&
        report.gameInputsApplied > 0
      ) {
        advanced = true;
        await bounded(options.advanceLocalRound(roomCode!), 120_000);
      }
      await pause(500);
    }
    if (
      !report.received.gameVideo ||
      !report.received.gameAudio ||
      report.gameInputsApplied === 0 ||
      report.mediaRooms.practice !== 2 ||
      report.mediaRooms.game !== 1
    )
      throw new Error('DP06_POSITIVE_GAME_EVIDENCE_MISSING');
    report.status = 'PASS';
  } catch (error) {
    report.failureCode = stage;
    // Observe before leave/drain can replace the state. Never serialize arbitrary errors,
    // snapshots, participant identities, grants or credentials.
    report.failureObservation = {
      ...(mediaFailureObservation ? { media: mediaFailureObservation } : {}),
      condition:
        error instanceof Error && /^DP06_[A-Z_]{1,100}$/.test(error.message) ? error.message : null,
      clients: snapshot().map((value) => ({
        phase: value.round?.phase ?? null,
        serverTick: value.round?.serverTick ?? null,
        startTick: value.round?.startTick ?? null,
        abortReason:
          value.round?.abortReason && ABORT_REASONS.includes(value.round.abortReason)
            ? value.round.abortReason
            : null,
        runtimeError: Boolean(value.error),
        connectionLost: value.lost,
      })),
    };
  } finally {
    cleaning = true;
    if (timer) clearInterval(timer);
    // Real normal retirement reports happen before each game socket is closed by C runtime.leave.
    for (const player of players) {
      try {
        await bounded(player.runtime.leave());
        await bounded(player.probe.close());
        const closed = await bounded(player.probe.snapshot());
        checkCleanup(!closed.connected && closed.localTracks.length === 0);
        report.cleanup.clientsClosed++;
      } catch {
        report.status = 'FAIL';
        report.failureCode = 'DP06_CLIENT_CLEANUP_FAILED';
      }
    }
    // Also close partially initialized clients; a failed probe construction must not leak WS.
    await Promise.allSettled(joinedRooms.map((room) => bounded(room.leave())));
    await Promise.allSettled(createdProbes.map((probe) => bounded(probe.close())));
    if (createdSession) {
      try {
        await command('drain');
        const drained = await status();
        checkCleanup(
          ['DRAINING', 'LOCKED'].includes(String(drained.admission)) &&
            drained.unresolvedCount === 0,
        );
        // E terminal drain verifies activity zero, journal retirement and reservation consistency.
        report.cleanup.drainConfirmed = true;
        if (report.status === 'PASS') {
          await command('resume');
          checkCleanup(healthy(await status(), 'OPEN'));
          report.cleanup.resumed = true;
        }
      } catch {
        report.status = 'FAIL';
        report.failureCode = 'DP06_SERVER_CLEANUP_FAILED';
      }
    }
    report.phaseCoverage = [...phases];
    report.durationMs = Date.now() - started;
  }
  return report;
}
