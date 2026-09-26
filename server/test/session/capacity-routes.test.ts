// S15P21C204-372. 홈 화면의 여유 표시. 개수만 내보내고 입장 시도 한도를 쓰지 않는다.
import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterEach, expect, it } from 'vitest';
import { SERVICE_CAPACITY_ROUTE, serviceCapacitySchema } from '@kkakkung/protocol/game-messages';
import { createCapacityRoutes } from '../../src/session/CapacityRoutes.js';
import type { AdmissionState } from '../../src/session/SessionRoutes.js';
import { SlotRegistry } from '../../src/session/SlotRegistry.js';

let server: Server | null = null;
afterEach(async () => {
  const current = server;
  server = null;
  if (current) await new Promise<void>((resolve) => current.close(() => resolve()));
});

async function serve(deps: Parameters<typeof createCapacityRoutes>[0]) {
  const app = express();
  app.use(createCapacityRoutes(deps));
  const current = createServer(app);
  server = current;
  await new Promise<void>((resolve) => current.listen(0, '127.0.0.1', resolve));
  const address = current.address();
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

it('reports lobby and match room counts without any room detail', async () => {
  const slots = new SlotRegistry({ maxRooms: 2, maxLobbyRooms: 5 });
  slots.reserve('ROOM01', 'a', 0, { create: true });
  slots.reserve('ROOM02', 'b', 0, { create: true });
  slots.setPhase('ROOM02', 'PLAYING', 0);
  // 시연 방은 일반 방 수에 들어가지 않는다.
  slots.reserve('SHOW01', 's', 0, { create: true, showcase: { seat: 'runner-1' } });
  let admission: AdmissionState = 'OPEN';
  let cleaned = 0;
  const endpoint = await serve({
    slots,
    admission: () => admission,
    canStartMatch: () => false,
    cleanupReservations: () => {
      cleaned += 1;
    },
  });
  const response = await fetch(endpoint + SERVICE_CAPACITY_ROUTE);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = serviceCapacitySchema.parse(await response.json());
  expect(body).toEqual({
    matchesInUse: 1,
    matchLimit: 2,
    lobbyRoomsInUse: 2,
    lobbyRoomLimit: 5,
    admissionOpen: true,
    mediaBlocked: true,
  });
  expect(JSON.stringify(body)).not.toContain('ROOM0');
  expect(cleaned).toBe(1);

  admission = 'DRAINING';
  const draining = serviceCapacitySchema.parse(
    await (await fetch(endpoint + SERVICE_CAPACITY_ROUTE)).json(),
  );
  expect(draining.admissionOpen).toBe(false);
});

it('treats a missing monthly guard as not blocking', async () => {
  const endpoint = await serve({
    slots: new SlotRegistry({ maxRooms: 1 }),
    admission: () => 'OPEN',
  });
  const body = serviceCapacitySchema.parse(
    await (await fetch(endpoint + SERVICE_CAPACITY_ROUTE)).json(),
  );
  expect(body.mediaBlocked).toBe(false);
});
