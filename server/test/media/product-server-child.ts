// Actual A/B/E/F server on its own Node event loop. The parent owns the six real C/SDK clients.
// Cloud/device boundaries remain synthetic. Never log IPC messages, tokens or provider secrets.
import { createHash } from 'node:crypto';
import { setImmediate as yieldIo } from 'node:timers/promises';
import { MEDIA_ROUTES } from '@kkakkung/protocol/game-messages';
import { createApplication } from '../../src/bootstrap.js';
import { parseConfig } from '../../src/config/env.js';
import { loadProductProfile } from '../../src/game/ProductProfileLoader.js';
import { createMediaCoordinator } from '../../src/media/MediaCoordinator.js';
import { productCloudFixture } from './product-cloud-fixture.js';
import { createProductServerProbe } from './product-server-probe.js';
import { startProductCpuProfile } from './product-server-profile.js';
import {
  PRODUCT_SERVER_IPC,
  isProductServerMessage,
  productServerRequestSchema,
  type ProductServerReply,
  type ProductServerInspection,
  type ProductServerRequest,
  type ProductServerResult,
} from './product-server-ipc.js';

type ProductState =
  NonNullable<
    Awaited<ReturnType<typeof loadProductProfile>>['core']
  > extends import('../../src/game/ports.js').CorePort<infer State>
    ? State
    : never;
let cloud: Awaited<ReturnType<typeof productCloudFixture>> | undefined;
let application: ReturnType<typeof createApplication<ProductState>> | undefined;
let endpoint: string | undefined;
let maxTickMs = 0;
let closing: Promise<void> | undefined;
let booting = false;
let advancing = false;
let stopProfile: (() => Promise<void>) | undefined;
const currentPhase = () => {
  if (!application) return 'BOOT';
  const roomCode = application.slots?.roomCodes().values().next().value;
  const room = roomCode ? application.directory.get(roomCode) : null;
  return room && 'phase' in room ? room.phase : 'NO_ROOM';
};
const probe = createProductServerProbe(currentPhase);

function inspect(roomCode?: string): ProductServerInspection {
  const handle = roomCode ? application?.directory.get(roomCode) : null;
  const diagnostic = handle && 'blockedReason' in handle ? handle.blockedReason : null;
  const readiness = application?.media?.getReadiness();
  return {
    readiness: readiness
      ? {
          state: readiness.state,
          reasonCodes: [...readiness.reasonCodes],
          historyComplete: readiness.historyComplete,
          unresolvedCount: readiness.unresolvedCount,
        }
      : null,
    blockedReason: typeof diagnostic === 'string' ? diagnostic.slice(0, 512) : null,
    maxTickMs,
    participantCount: cloud?.participants.size ?? 0,
    removedIdentityHashes: (cloud?.removed ?? []).map((identity) =>
      createHash('sha256').update(identity).digest('hex'),
    ),
    probe: probe.snapshot(),
  };
}

async function close() {
  closing ??= (async () => {
    probe.close();
    try {
      await application?.close();
    } finally {
      try {
        await cloud?.close();
      } finally {
        await stopProfile?.();
      }
    }
  })();
  await closing;
}

async function dispatch(request: ProductServerRequest): Promise<ProductServerResult> {
  if (request.action === 'boot') {
    if (booting || application || closing) throw new Error('ALREADY_STARTED');
    booting = true;
    if (request.cpuProfile)
      stopProfile = await startProductCpuProfile(() => probe.snapshot(), currentPhase);
    cloud = await productCloudFixture(request.operatingMode);
    const window = cloud.config.publicWindow;
    const config = {
      ...parseConfig({
        NODE_ENV: 'test',
        SERVER_PROFILE: 'product',
        LOG_LEVEL: 'silent',
        OPS_TOKEN: request.opsToken,
        INVITE_MAX_TTL_MS: '600000',
        SESSION_ATTEMPT_WINDOW_MS: '60000',
        SESSION_ATTEMPTS_PER_INVITE: '30',
        SESSION_ATTEMPTS_PER_IP: '60',
        ROOM_IDLE_TTL_MS: '600000',
        OPS_OPERATING_MODE: request.operatingMode,
        ...(window && !('mode' in window)
          ? {
              OPS_PUBLIC_WINDOW_OPENS_AT_EPOCH_MS: String(window.opensAtEpochMs),
              OPS_PUBLIC_WINDOW_CLOSES_AT_EPOCH_MS: String(window.closesAtEpochMs),
            }
          : {}),
      }),
      port: 0,
    };
    const profile = await loadProductProfile(config);
    const fixture = cloud;
    application = createApplication(config, {
      ...profile,
      emitMetric: (sample) => {
        if (sample.name === 'tick.duration') maxTickMs = Math.max(maxTickMs, sample.value);
      },
      mediaConfig: fixture.config,
      createMediaCoordinator: (deps) =>
        createMediaCoordinator(
          {
            ...deps,
            enqueueBindings: (playerId, value) =>
              deps.enqueueBindings(playerId, {
                ...value,
                participants: value.participants.map((participant) => ({ ...participant })),
              }),
            enqueueAudioPolicy: (playerId, value) =>
              deps.enqueueAudioPolicy(playerId, {
                ...value,
                voices: value.voices.map((voice) => ({ ...voice })),
                effects: value.effects.map((effect) => ({ ...effect })),
              }),
          },
          { ...fixture.services, productSecurityReady: () => deps.config.productSecurityReady },
        ),
    });
    const port = await application.listen();
    endpoint = `http://127.0.0.1:${port}`;
    return { port, pid: process.pid, strictProduct: profile.strictProduct === true };
  }
  if (request.action === 'close') {
    await close();
    return { done: true };
  }
  if (!application || !cloud || !endpoint || closing) throw new Error('NOT_STARTED');
  if (request.action === 'inspect') return inspect(request.roomCode);
  if (request.action === 'publish') {
    cloud.publish(request.publication);
    const event = await cloud.publicationEvent(request.publication);
    const response = await fetch(endpoint + MEDIA_ROUTES.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json', authorization: event.authorization },
      body: event.rawBody,
    });
    if (response.status !== 200) throw new Error('REQUEST_FAILED');
    return { done: true };
  }
  if (advancing) throw new Error('REQUEST_FAILED');
  const handle = application.directory.get(request.roomCode);
  if (!handle || !('tick' in handle) || typeof handle.tick !== 'function')
    throw new Error('REQUEST_FAILED');
  advancing = true;
  try {
    // Fixed-tick functional acceleration only: production timers, epoch and 250ms gate stay live.
    for (let tick = 0; tick < request.ticks; tick++) {
      handle.tick();
      await yieldIo();
    }
  } finally {
    advancing = false;
  }
  return { done: true };
}

function reply(message: ProductServerReply, disconnect = false) {
  if (!process.connected || !process.send) return;
  process.send({ namespace: PRODUCT_SERVER_IPC, ...message }, () => {
    if (disconnect && process.connected) process.disconnect();
  });
}

process.on('message', (message: unknown) => {
  if (!isProductServerMessage(message)) return;
  const parsed = productServerRequestSchema.safeParse(message);
  if (!parsed.success) {
    // Do not serialize parser errors or input: a boot request contains an ephemeral operator token.
    reply({ id: 0, ok: false, code: 'INVALID_REQUEST' });
    return;
  }
  const request = parsed.data;
  void dispatch(request).then(
    (result) => reply({ id: request.id, ok: true, result }, request.action === 'close'),
    async () => {
      if (request.action === 'boot') await close().catch(() => undefined);
      reply({ id: request.id, ok: false, code: 'REQUEST_FAILED' });
    },
  );
});
process.on('disconnect', () => {
  void close().then(
    () => {
      process.exitCode = 0;
    },
    () => {
      process.exitCode = 1;
    },
  );
});
