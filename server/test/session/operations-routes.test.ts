import { createServer, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OperationsPort, OperationSnapshot } from '../../src/game/ports.js';
import { OPERATIONS_ROUTES, createOperationsRoutes } from '../../src/session/OperationsRoutes.js';
import { TEST_OPS_TOKEN, createTestOperatorAuth } from '../room/test-harness.js';

/** Test double shaped like E's OperationsPort: same requestId/body → same operationId, else conflict. */
function fakeOperations(): OperationsPort & { snapshots: Map<string, OperationSnapshot> } {
  const snapshots = new Map<string, OperationSnapshot>();
  const bodies = new Map<string, string>();
  let admission: 'OPEN' | 'DRAINING' | 'LOCKED' = 'OPEN';
  return {
    snapshots,
    submit(command) {
      const body = JSON.stringify(command);
      const existing = bodies.get(command.requestId);
      if (existing && existing !== body) return { status: 'conflict', code: 'REQUEST_ID_CONFLICT' };
      if (!existing) {
        bodies.set(command.requestId, body);
        snapshots.set(command.requestId, {
          requestId: command.requestId,
          operationId: `op-${snapshots.size + 1}`,
          action: command.action,
          status: 'pending',
          code: null,
          updatedAtEpochMs: 1,
        });
        if (command.action === 'drain') admission = 'DRAINING';
      }
      return { status: 'accepted', snapshot: snapshots.get(command.requestId)! };
    },
    getSnapshot: (requestId) => snapshots.get(requestId) ?? null,
    getStatus: () => ({
      admission,
      readiness: 'READY',
      unresolvedCount: 0,
      remainingMinutes: null,
      remainingBytes: null,
      checkedAtEpochMs: null,
    }),
  };
}

describe('operations routes', () => {
  let server: Server;
  let endpoint: string;
  let port: OperationsPort | null = fakeOperations();
  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2kb' }));
    app.use(
      createOperationsRoutes({
        operations: () => port,
        authorize: createTestOperatorAuth(TEST_OPS_TOKEN),
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const auth = { authorization: `Bearer ${TEST_OPS_TOKEN}` };
  const post = (body: unknown, headers: Record<string, string> = auth) =>
    fetch(endpoint + OPERATIONS_ROUTES.commands, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('accepts a drain as 202 pending, keeps the same operationId for the same body and 409 for a different one', async () => {
    const first = await post({ requestId: 'req-1', action: 'drain' });
    expect(first.status).toBe(202);
    const snapshot = (await first.json()) as OperationSnapshot;
    expect(snapshot.status).toBe('pending');
    const again = await post({ requestId: 'req-1', action: 'drain' });
    expect(((await again.json()) as OperationSnapshot).operationId).toBe(snapshot.operationId);
    expect((await post({ requestId: 'req-1', action: 'resume' })).status).toBe(409);
    const status = await fetch(endpoint + OPERATIONS_ROUTES.status, { headers: auth });
    expect(await status.json()).toMatchObject({
      admission: 'DRAINING',
      readiness: 'READY',
      remainingMinutes: null,
    });
    const lookup = await fetch(
      endpoint + OPERATIONS_ROUTES.snapshot.replace(':requestId', 'req-1'),
      { headers: auth },
    );
    expect(lookup.status).toBe(200);
    expect(((await lookup.json()) as OperationSnapshot).status).toBe('pending');
    expect(
      (
        await fetch(endpoint + OPERATIONS_ROUTES.snapshot.replace(':requestId', 'missing'), {
          headers: auth,
        })
      ).status,
    ).toBe(404);
  });

  it('validates the command shape, requires retirementId only for retry-retirement and rejects wrong tokens', async () => {
    expect((await post({ requestId: 'req-2', action: 'retry-retirement' })).status).toBe(400);
    expect(
      (await post({ requestId: 'req-2', action: 'retry-retirement', retirementId: 'ret-1' }))
        .status,
    ).toBe(202);
    expect((await post({ requestId: 'req-3', action: 'drain', retirementId: 'x' })).status).toBe(
      400,
    );
    expect(
      (await post({ requestId: 'req-4', action: 'drain' }, { authorization: 'Bearer wrong' }))
        .status,
    ).toBe(401);
    expect((await post({ requestId: 'req-4', action: 'drain' }, {})).status).toBe(401);
  });

  it('answers 503 when no operations port exists instead of pretending acceptance', async () => {
    port = null;
    expect((await post({ requestId: 'req-9', action: 'drain' })).status).toBe(503);
    expect((await fetch(endpoint + OPERATIONS_ROUTES.status, { headers: auth })).status).toBe(503);
    port = fakeOperations();
  });
});
