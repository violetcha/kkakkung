import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MediaGrant } from '@kkakkung/protocol/game-messages';
import {
  PRODUCT_SERVER_IPC,
  isProductServerMessage,
  productServerReplySchema,
  type ProductServerCommand,
  type ProductServerInspection,
  type ProductServerResult,
} from './product-server-ipc.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const childEntry = fileURLToPath(new URL('./product-server-child.ts', import.meta.url));

/** Actual server process isolated from Vitest's six C/SDK clients; no public debug endpoints. */
export async function startProductServerProcess(
  opsToken: string,
  options: {
    cpuProfile?: boolean;
    operatingMode?: 'attested' | 'continuous';
    rooms?: number;
    subscriptionMode?: 'publisher-permissions';
    /** Guest admission behind the trusted proxy (SERVICE_AUDIENCE=public). */
    audience?: 'public';
  } = {},
) {
  const child = spawn(process.execPath, ['--import', 'tsx', childEntry], {
    cwd: root,
    windowsHide: true,
    // Do not inherit LiveKit/Jenkins/operator credentials or NODE_OPTIONS from the host.
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          [
            'path',
            'systemroot',
            'windir',
            'temp',
            'tmp',
            'home',
            'userprofile',
            'appdata',
            'localappdata',
          ].includes(key.toLowerCase()),
        ),
      ),
      // S15P21C204-302. These processes carry the deployment and media wiring contracts, not
      // map behaviour, and their positive in-game audio evidence comes from six synthetic
      // clients wandering into earshot of each other. On the corridor maze that became a coin
      // flip: deliberately walking them together did not fix it, so the cause is not distance.
      // Pinned to the open grid until S15P21C204-308 makes the evidence map-independent and
      // S15P21C204-309 answers whether corridor audibility is a product problem. The product
      // default stays maze-v1 and the real Cloud DP-06 still runs on it.
      PRODUCT_MAP_TEMPLATE: 'master-v1',
    },
    // Child errors use a fixed IPC code. Raw logs and payloads cannot expose grant/credential data.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let nextId = 0;
  let exited = false;
  let closing: Promise<void> | undefined;
  const pending = new Map<
    number,
    {
      resolve(value: ProductServerResult): void;
      reject(reason: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  const failPending = (code: string) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(code));
    }
    pending.clear();
  };
  const exit = new Promise<void>((resolve) =>
    child.once('close', () => {
      exited = true;
      failPending('PRODUCT_SERVER_EXITED');
      resolve();
    }),
  );
  child.on('error', () => failPending('PRODUCT_SERVER_PROCESS_ERROR'));
  child.on('message', (message: unknown) => {
    if (!isProductServerMessage(message)) return;
    const parsed = productServerReplySchema.safeParse(message);
    if (!parsed.success) {
      failPending('PRODUCT_SERVER_INVALID_REPLY');
      return;
    }
    const reply = parsed.data;
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    clearTimeout(entry.timer);
    if (reply.ok) entry.resolve(reply.result);
    else entry.reject(new Error(`PRODUCT_SERVER_${reply.code}`));
  });
  const request = (
    command: ProductServerCommand,
    timeoutMs = 15000,
  ): Promise<ProductServerResult> => {
    if (exited || !child.connected)
      return Promise.reject(new Error('PRODUCT_SERVER_NOT_CONNECTED'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`PRODUCT_SERVER_${command.action.toUpperCase()}_TIMEOUT`));
      }, timeoutMs);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      child.send({ namespace: PRODUCT_SERVER_IPC, id, ...command }, (error) => {
        if (!error) return;
        const entry = pending.get(id);
        pending.delete(id);
        if (entry) {
          clearTimeout(entry.timer);
          entry.reject(new Error('PRODUCT_SERVER_SEND_FAILED'));
        }
      });
    });
  };
  const close = () => {
    closing ??= (async () => {
      if (exited) return;
      try {
        await request({ action: 'close' }, 10000);
      } catch {
        child.kill();
      }
      const timer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 3000);
      timer.unref();
      try {
        await exit;
      } finally {
        clearTimeout(timer);
      }
    })();
    return closing;
  };
  try {
    const started = await request(
      {
        action: 'boot',
        opsToken,
        operatingMode: options.operatingMode,
        ...(options.cpuProfile ? { cpuProfile: true } : {}),
        ...(options.rooms ? { rooms: options.rooms } : {}),
        ...(options.subscriptionMode ? { subscriptionMode: options.subscriptionMode } : {}),
        ...(options.audience ? { audience: options.audience } : {}),
      },
      30000,
    );
    if (!('port' in started)) throw new Error('PRODUCT_SERVER_INVALID_BOOT_REPLY');
    return {
      endpoint: `http://127.0.0.1:${started.port}`,
      pid: started.pid,
      strictProduct: started.strictProduct,
      async inspect(roomCode?: string): Promise<ProductServerInspection> {
        const result = await request({ action: 'inspect', ...(roomCode ? { roomCode } : {}) });
        if (!('participantCount' in result))
          throw new Error('PRODUCT_SERVER_INVALID_INSPECT_REPLY');
        return result;
      },
      async publish(grant: MediaGrant) {
        // JWT stays exclusively in the client's memory/HTTPS grant response, never in IPC/logs.
        await request({
          action: 'publish',
          publication: { roomName: grant.roomName, mediaIdentity: grant.mediaIdentity },
        });
      },
      async advanceTicks(roomCode: string, ticks: number) {
        await request({ action: 'advance', roomCode, ticks }, 120000);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
