import { randomUUID } from 'node:crypto';
import { Server, ServerError, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import cors from 'cors';
import { pino } from 'pino';
import { devSessionRequestSchema, joinOptionsSchema } from '@kkakkung/protocol/messages';
import {
  MEDIA_ROUTES,
  mediaGrantRequestSchema,
  mediaStatusReportSchema,
} from '@kkakkung/protocol/game-messages';
import {
  PROTOCOL_VERSION,
  PRODUCT_PROTOCOL_VERSION,
  PRODUCT_ROOM_NAME,
  ROOM_NAME,
} from '@kkakkung/protocol/version';
import { monitor } from '@colyseus/monitor';
import { playground } from '@colyseus/playground';
import type { AppConfig } from './config/env.js';
import { LayoutLoader } from './game/LayoutLoader.js';
import { createServerEpoch } from './game/MatchContext.js';
import { RoomTickCoordinator } from './game/RoomTickCoordinator.js';
import type {
  CorePort,
  CreateMediaCoordinator,
  CreateOperatorAuth,
  EmitMetric,
  LayoutSelectionPort,
  MapPreparationPort,
  MatchTuning,
  MediaConfiguration,
  MediaCoordinator,
  PracticeLayoutPort,
} from './game/ports.js';
import { createGameRoom } from './rooms/GameRoom.js';
import { DevKkakkungRoom } from './rooms/DevKkakkungRoom.js';
import { createKkakkungRoom } from './rooms/KkakkungRoom.js';
import { RoomDirectory } from './rooms/RoomDirectory.js';
import { AdmissionLimiter } from './session/AdmissionLimiter.js';
import { checkOrigin, installHttpBoundary } from './session/HttpBoundary.js';
import { InviteStore } from './session/InviteStore.js';
import { createInvitationRoutes } from './session/InvitationRoutes.js';
import { createOperationsRoutes } from './session/OperationsRoutes.js';
import { ProductSessionStore } from './session/ProductSessionStore.js';
import { RoomExpiry } from './session/RoomExpiry.js';
import { createSessionRoutes, type AdmissionState } from './session/SessionRoutes.js';
import { SessionStore } from './session/SessionStore.js';
import { SlotRegistry } from './session/SlotRegistry.js';
import { readFile } from 'node:fs/promises';

/**
 * Product profile assembled by B from producer exports. Every field is explicit: F's validated
 * configuration values, A's core/map ports, E's media and operator-auth factories. Missing
 * producers keep the matching capability disabled and reported, never faked.
 */
export type ProductProfile<State = unknown> = Readonly<{
  serverEpoch?: string;
  monotonicNow?: () => number;
  epochNow?: () => number;
  random?: () => number;
  maxRooms: number;
  inviteMaxTtlMs: number | null;
  publicWindow: Readonly<{ opensAtEpochMs: number; closesAtEpochMs: number }> | null;
  sessionAttempts: Readonly<{ windowMs: number; perInvite: number; perIp: number }> | null;
  roomIdleTtlMs: number | null;
  trustProxy: boolean;
  opsToken: string | null;
  createOperatorAuth: CreateOperatorAuth | null;
  createMediaCoordinator: CreateMediaCoordinator | null;
  mediaConfig: Omit<MediaConfiguration, 'productSecurityReady'> | null;
  core: CorePort<State> | null;
  tuning: MatchTuning | null;
  practice: { port: PracticeLayoutPort; raw: unknown } | null;
  layouts: {
    maps: MapPreparationPort;
    selection: LayoutSelectionPort;
    masterPath: string;
    fallbackPath: string;
    templateId: string;
    templateVersion: string;
  } | null;
  emitMetric?: EmitMetric;
  assetVersion?: string;
  /**
   * Development/test only (parseConfig already forbids production): admission source when no
   * media coordinator exists. Never read from the environment and never exposed over HTTP.
   */
  developmentAdmission?: () => AdmissionState;
}>;

export function createApplication<State = unknown>(
  config: AppConfig,
  product?: ProductProfile<State>,
) {
  const sessions = new SessionStore();
  const logger = pino({ level: config.logLevel, base: { service: config.namespace } });
  let ready = false;
  const allowedOrigin = (origin: string | null | undefined) =>
    checkOrigin(origin === null ? undefined : origin, config.allowedOrigins) !== 'rejected';
  const transport = new WebSocketTransport({
    maxPayload: 8192,
    beforeUpgrade(request) {
      if (!allowedOrigin(request.headers.get('origin'))) return new Response(null, { status: 403 });
    },
  });

  const monotonicNow = product?.monotonicNow ?? (() => performance.now());
  const epochNow = product?.epochNow ?? (() => Date.now());
  const serverEpoch = product?.serverEpoch ?? createServerEpoch();
  const productSessions = new ProductSessionStore({ now: epochNow });
  const slots = product ? new SlotRegistry({ maxRooms: product.maxRooms }) : null;
  const directory = new RoomDirectory();
  const coordinator = new RoomTickCoordinator({
    now: monotonicNow,
    emitMetric: product?.emitMetric,
  });
  let media: MediaCoordinator | null = null;
  const admission = (): AdmissionState => {
    if (media) return media.getOperations().getStatus().admission;
    return product?.developmentAdmission?.() ?? 'LOCKED';
  };
  // Without E's coordinator, readiness is unknown and stays LOCKED unless the explicit
  // development admission hook is present (development/test profile only).
  const readinessState = (): 'READY' | 'RECOVERING' | 'LOCKED' =>
    media ? media.getReadiness().state : product?.developmentAdmission ? 'READY' : 'LOCKED';
  const operationsReady = () => readinessState() === 'READY' && admission() === 'OPEN';
  const productSecurityReady = Boolean(
    product &&
    product.opsToken &&
    product.createOperatorAuth &&
    product.sessionAttempts &&
    product.inviteMaxTtlMs !== null &&
    config.allowedOrigins.length > 0,
  );
  const invites =
    product && slots
      ? new InviteStore({
          now: epochNow,
          maxTtlMs: product.inviteMaxTtlMs,
          publicWindow: product.publicWindow,
          knownRoomCodes: () => slots.roomCodes(),
          operationsReady,
        })
      : null;
  const limiter = product?.sessionAttempts ? new AdmissionLimiter(product.sessionAttempts) : null;
  const roomExpiry = new RoomExpiry(product?.roomIdleTtlMs ?? null);
  const authorize =
    product?.opsToken && product.createOperatorAuth
      ? product.createOperatorAuth(product.opsToken)
      : null;

  if (product?.createMediaCoordinator && product.mediaConfig) {
    media = product.createMediaCoordinator({
      config: { ...product.mediaConfig, productSecurityReady },
      emitMetric: product.emitMetric ?? (() => undefined),
      enqueueControl: (control) => {
        const matchId = control.type === 'MEDIA_FAILED' ? control.matchId : control.result.matchId;
        directory.byMatch(matchId)?.enqueueMediaControl(control);
      },
      enqueueBindings: (playerId, message) =>
        directory.byMatch(message.matchId)?.deliverBindings(playerId, message),
      enqueueAudioPolicy: (playerId, message) =>
        directory.byMatch(message.matchId)?.deliverAudioPolicy(playerId, message),
      monotonicNow,
      epochNowSeconds: () => Math.floor(epochNow() / 1000),
      getGameActivity: () =>
        slots?.activity() ?? { activeMatches: 0, activePractices: 0, pendingAdmissions: 0 },
    });
  }

  const bearer = (req: Request) => {
    const header = req.headers.authorization;
    return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  };

  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
    express(app) {
      app.disable('x-powered-by');
      app.use((request, response, next) => {
        if (!allowedOrigin(request.headers.origin)) {
          response.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
          return;
        }
        next();
      });
      app.use(cors({ origin: config.allowedOrigins }));
      // Raw body for provider signature verification; registered before the JSON parser.
      app.post(
        MEDIA_ROUTES.webhook,
        express.text({ type: '*/*', limit: '256kb' }),
        async (req, res) => {
          if (!media) return void res.status(503).json({ error: 'MEDIA_UNAVAILABLE' });
          const raw = typeof req.body === 'string' ? req.body : '';
          const result = await media.handleWebhook(raw, String(req.headers.authorization ?? ''));
          res.status(200).json(result);
        },
      );
      app.use(express.json({ limit: '2kb' }));
      app.get('/health/live', (_req, res) => res.json({ status: 'alive' }));
      app.get('/health', (_req, res) =>
        res.json({ ok: true, stage: product ? 'product-assembly' : 'skeleton' }),
      );
      // This bootstrap is restricted to development/test by parseConfig.
      app.use('/monitor', monitor());
      app.use('/playground', playground());
      app.get('/health/ready', (_req, res) => {
        const readiness = readinessState();
        const healthy = ready && (!product || readiness === 'READY');
        res.status(healthy ? 200 : 503).json({
          status: healthy ? 'ready' : ready ? 'recovering' : 'starting',
          stage: product ? 'product-assembly' : 'skeleton',
          mvpReady: false,
          mediaEnabled: media !== null,
          readiness: product ? readiness : undefined,
          admission: product ? admission() : undefined,
          productSecurityReady,
        });
      });
      app.get('/api/config', (_req, res) =>
        res.json({
          stage: product ? 'product-assembly' : 'skeleton',
          protocolVersion: product ? PRODUCT_PROTOCOL_VERSION : PROTOCOL_VERSION,
          roomName: PRODUCT_ROOM_NAME,
          diagnosticRoomName: ROOM_NAME,
          mediaEnabled: media !== null,
          maxPlayers: 6,
        }),
      );
      app.post('/api/dev-sessions', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const result = devSessionRequestSchema.safeParse(req.body);
        if (!result.success) {
          res.status(400).json({ error: 'INVALID_NICKNAME' });
          return;
        }
        try {
          res.status(201).json(sessions.issue(result.data.nickname));
        } catch {
          res.status(429).json({ error: 'SESSION_CAPACITY' });
        }
      });
      if (product && slots && invites) {
        app.use(
          createSessionRoutes({
            invites,
            sessions: productSessions,
            slots,
            limiter,
            admission,
            monotonicNow,
            trustProxy: product.trustProxy,
          }),
        );
        if (authorize) {
          app.use(createInvitationRoutes({ invites, authorize }));
          app.use(
            createOperationsRoutes({ operations: () => media?.getOperations() ?? null, authorize }),
          );
        } else {
          app.use('/api/operations', (_req, res) =>
            res.status(503).json({ error: 'OPERATOR_AUTH_UNAVAILABLE' }),
          );
        }
        const authenticate = (req: Request, res: Response) => {
          const auth = productSessions.authenticate(bearer(req));
          if (!auth) res.status(401).json({ error: 'INVALID_SESSION' });
          return auth;
        };
        app.post(MEDIA_ROUTES.grants, async (req, res) => {
          res.setHeader('Cache-Control', 'no-store');
          const auth = authenticate(req, res);
          if (!auth) return;
          const parsed = mediaGrantRequestSchema.safeParse(req.body);
          if (!parsed.success) return void res.status(400).json({ error: 'INVALID_REQUEST' });
          const room = directory.get(auth.roomCode);
          if (!room || room.matchId !== parsed.data.matchId)
            return void res.status(409).json({ error: 'WRONG_SCOPE' });
          const scope = room.mediaScopeFor(auth.playerId, parsed.data.purpose);
          if (!scope) return void res.status(409).json({ error: 'NOT_READY' });
          if (!media) return void res.status(503).json({ error: 'MEDIA_UNAVAILABLE' });
          if (!operationsReady()) return void res.status(409).json({ error: 'NOT_READY' });
          const result = await media.prepareGeneration({
            requestId: randomUUID(),
            matchId: room.matchId,
            playerId: auth.playerId,
            mediaInstanceId: scope.mediaInstanceId,
            purpose: parsed.data.purpose,
            expectedPreviousGeneration: parsed.data.previousReceiverGeneration ?? null,
          });
          room.enqueueMediaControl({ type: 'MEDIA_PREPARED', result });
          if (result.status === 'ready') return void res.status(200).json(result.grant);
          res.status(result.status === 'unknown' ? 503 : 409).json({ error: result.code });
        });
        app.post(MEDIA_ROUTES.report, (req, res) => {
          res.setHeader('Cache-Control', 'no-store');
          const auth = authenticate(req, res);
          if (!auth) return;
          const parsed = mediaStatusReportSchema.safeParse(req.body);
          if (!parsed.success) return void res.status(400).json({ error: 'INVALID_REQUEST' });
          const room = directory.get(auth.roomCode);
          if (!room || room.matchId !== parsed.data.matchId)
            return void res.status(409).json({ error: 'WRONG_SCOPE' });
          res.status(204).end();
        });
      }
      const onError: ErrorRequestHandler = (_error, _req, res, _next) => {
        res.status(400).json({ error: 'INVALID_REQUEST' });
      };
      app.use(onError);
    },
  });

  server.define(ROOM_NAME, createGameRoom(sessions));
  if (product && slots) {
    const RoomClass = createKkakkungRoom<State>({
      serverEpoch,
      monotonicNow,
      sessions: productSessions,
      slots,
      directory,
      coordinator,
      roomExpiry,
      core: product.core,
      tuning: product.tuning,
      practice: product.practice,
      layouts: product.layouts
        ? {
            loader: new LayoutLoader({
              readFile: (path) => readFile(path),
              maps: product.layouts.maps,
              selection: product.layouts.selection,
              now: monotonicNow,
            }),
            masterPath: product.layouts.masterPath,
            fallbackPath: product.layouts.fallbackPath,
            templateId: product.layouts.templateId,
            templateVersion: product.layouts.templateVersion,
          }
        : null,
      media,
      assetVersion: product.assetVersion ?? 'assets-unversioned',
      emitMetric: product.emitMetric,
      random: product.random,
      onInvalidateRoom: (roomCode) => invites?.forgetRoom(roomCode),
    });
    server.define(PRODUCT_ROOM_NAME, RoomClass).filterBy(['roomCode']);
  } else {
    class TeamRoom extends DevKkakkungRoom {
      onAuth(_client: Client, options: unknown) {
        // Preserve the team's local Playground contract. Production cannot boot this profile.
        if (
          options === undefined ||
          (typeof options === 'object' && options !== null && Object.keys(options).length === 0)
        )
          return true;
        const result = joinOptionsSchema.safeParse(options);
        if (!result.success) throw new ServerError(400, 'INVALID_JOIN');
        if (result.data.protocolVersion !== PROTOCOL_VERSION)
          throw new ServerError(409, 'PROTOCOL_MISMATCH');
        const session = sessions.consume(result.data.token);
        if (!session) throw new ServerError(401, 'INVALID_SESSION');
        return session;
      }
    }
    server.define(PRODUCT_ROOM_NAME, TeamRoom);
  }

  let tickTimer: NodeJS.Timeout | null = null;
  return {
    server,
    serverEpoch,
    directory,
    slots,
    coordinator,
    invites,
    productSessions,
    get media() {
      return media;
    },
    async listen() {
      if (media) {
        const init = await media.initialize();
        if (init.status === 'fatal') {
          await media.close();
          throw new Error(`MEDIA_INITIALIZATION_${init.code}`);
        }
        logger.info(
          { readiness: init.readiness.state, admission: init.admission },
          'Media coordinator initialized',
        );
      }
      await server.listen(config.port, config.host);
      const httpServer = transport.server;
      if (httpServer)
        installHttpBoundary(httpServer, {
          allowedOrigins: config.allowedOrigins,
          rawBodyPaths: [MEDIA_ROUTES.webhook],
          onRejected: (info) => logger.warn(info, 'HTTP boundary rejected request'),
        });
      tickTimer = setInterval(() => coordinator.run(), 10);
      tickTimer.unref();
      ready = true;
      const address = httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : config.port;
      logger.info(
        { port, stage: product ? 'product-assembly' : 'skeleton', mediaEnabled: media !== null },
        'Server ready',
      );
      return port;
    },
    async close() {
      ready = false;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      await server.gracefullyShutdown(false);
      if (media) await media.close();
    },
  };
}
