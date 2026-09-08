import { Server, ServerError, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { pino } from 'pino';
import { devSessionRequestSchema, joinOptionsSchema } from '@kkakkung/protocol/messages';
import { PROTOCOL_VERSION, ROOM_NAME } from '@kkakkung/protocol/version';
import type { AppConfig } from './config/env.js';
import { SessionStore } from './session/SessionStore.js';
import { createGameRoom } from './rooms/GameRoom.js';
import { KkakkungRoom } from './rooms/KkakkungRoom.js';
import { monitor } from '@colyseus/monitor';
import { playground } from '@colyseus/playground';

export function createApplication(config: AppConfig) {
  const sessions = new SessionStore();
  const logger = pino({ level: config.logLevel, base: { service: config.namespace } });
  let ready = false;
  const allowedOrigin = (origin: string | null | undefined) =>
    !origin || config.allowedOrigins.includes(origin);
  const transport = new WebSocketTransport({
    maxPayload: 8192,
    beforeUpgrade(request) {
      if (!allowedOrigin(request.headers.get('origin'))) return new Response(null, { status: 403 });
    },
  });
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
      app.use(express.json({ limit: '2kb' }));
      app.get('/health/live', (_req, res) => res.json({ status: 'alive' }));
      app.get('/health', (_req, res) => res.json({ ok: true, stage: 'skeleton' }));
      // This bootstrap is restricted to development/test by parseConfig.
      app.use('/monitor', monitor());
      app.use('/playground', playground());
      app.get('/health/ready', (_req, res) =>
        res.status(ready ? 200 : 503).json({
          status: ready ? 'ready' : 'starting',
          stage: 'skeleton',
          mvpReady: false,
          mediaEnabled: false,
        }),
      );
      app.get('/api/config', (_req, res) =>
        res.json({
          stage: 'skeleton',
          protocolVersion: PROTOCOL_VERSION,
          roomName: 'kkakkung',
          diagnosticRoomName: ROOM_NAME,
          mediaEnabled: false,
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
      const onError: ErrorRequestHandler = (_error, _req, res, _next) => {
        res.status(400).json({ error: 'INVALID_REQUEST' });
      };
      app.use(onError);
    },
  });
  server.define(ROOM_NAME, createGameRoom(sessions));
  class TeamRoom extends KkakkungRoom {
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
  server.define('kkakkung', TeamRoom);
  return {
    server,
    async listen() {
      await server.listen(config.port, config.host);
      ready = true;
      const address = transport.server?.address();
      const port = typeof address === 'object' && address ? address.port : config.port;
      logger.info({ port, stage: 'skeleton', mediaEnabled: false }, 'Local sandbox ready');
      return port;
    },
    async close() {
      ready = false;
      await server.gracefullyShutdown(false);
    },
  };
}
