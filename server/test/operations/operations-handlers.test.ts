import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationSnapshot, OperationsStatus } from '../../src/media/types.js';
import { createOperatorAuth } from '../../src/operations/OperatorAuth.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import { OperationsController } from '../../src/operations/OperationsController.js';
import { createOperationsHandlers } from '../../src/operations/OperationsHandlers.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';

const closers: (() => Promise<void>)[] = [];
const directories: string[] = [];
const secrets = {
  token: 'must-never-be-returned',
  mediaIdentity: 'raw-private-identity',
  hiddenMap: [1, 2, 3],
};
const pending: OperationSnapshot = {
  requestId: 'req-1',
  operationId: 'op-1',
  action: 'drain',
  status: 'pending',
  code: null,
  updatedAtEpochMs: 1_000,
};
const healthy: OperationsStatus = {
  admission: 'DRAINING',
  readiness: 'READY',
  unresolvedCount: 0,
  remainingMinutes: null,
  remainingBytes: null,
  checkedAtEpochMs: null,
};

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('kkakkung-e14-http-')
    )
      throw new Error('UNSAFE_TEST_DIRECTORY');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

async function fixture(realController = false) {
  const opsDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e14-http-'));
  directories.push(opsDataDir);
  const journal = new OperationJournal({ opsDataDir });
  await journal.restore();
  closers.push(() => journal.close());
  const audit = new OperationsAudit({
    opsDataDir,
    nowEpochMs: () => 2_000,
    isWritable: () => journal.writable,
    allowMissingHistory: () => true,
  });
  closers.push(() => audit.close());
  await audit.restore();
  let admission: OperationsStatus['admission'] = 'DRAINING';
  const run = vi.fn(async () => {});
  const controller = new OperationsController({
    nowEpochMs: () => 2_000,
    monotonicNow: () => performance.now(),
    timeoutMs: 5_000,
    setAdmission: (value) => {
      admission = value;
    },
    getStatus: () => ({ ...healthy, admission }),
    canResume: () => true,
    run,
    auditStore: audit,
  });
  if (realController) await controller.initializeAudit();
  closers.push(() => controller.close());
  const operations = realController
    ? controller
    : {
        submit: vi.fn(() => ({
          status: 'accepted' as const,
          snapshot: { ...pending, ...secrets },
        })),
        getSnapshot: vi.fn(() => ({ ...pending, ...secrets })),
        getStatus: vi.fn(() => ({ ...healthy, ...secrets })),
      };
  const onAuditFailure = vi.fn();
  const app = express();
  app.use(express.json());
  const handlers = createOperationsHandlers({
    authorize: createOperatorAuth('operator-fixture'),
    operations,
    audit,
    onAuditFailure,
  });
  app.post('/api/operations/commands', handlers.command);
  app.get('/api/operations/commands/:requestId', handlers.snapshot);
  app.get('/api/operations/status', handlers.status);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    url: string,
    body?: unknown,
    authorization: string | null = 'Bearer operator-fixture',
  ) =>
    fetch(endpoint + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(authorization === null ? {} : { authorization }),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { audit, operations, controller, run, request, onAuditFailure, opsDataDir };
}

describe('E-14 operations HTTP handler exports through a local Express fixture', () => {
  it.each([
    ['/api/operations/commands', { requestId: 'attacker-never-saved', action: 'drain' }],
    ['/api/operations/commands/attacker-never-saved', undefined],
    ['/api/operations/status', undefined],
  ] as const)('requires OPS_TOKEN on every POST/GET route %s', async (url, body) => {
    const { operations, request, opsDataDir } = await fixture();
    const response = await request(url, body, 'Bearer player-session-fixture');
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(operations.submit).not.toHaveBeenCalled();
    expect(operations.getSnapshot).not.toHaveBeenCalled();
    expect(operations.getStatus).not.toHaveBeenCalled();
    const persisted = await fs.readFile(path.join(opsDataDir, 'operations-audit.json'), 'utf8');
    expect(persisted).toContain('auth-failed');
    expect(persisted).not.toMatch(/attacker-never-saved|player-session-fixture/);
  });

  it('rejects missing authentication before interpreting the command', async () => {
    const { request, operations } = await fixture();
    const response = await request(
      '/api/operations/commands',
      { token: 'unsafe', action: 'unknown' },
      null,
    );
    expect(response.status).toBe(403);
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it.each([
    {},
    [],
    { requestId: 'req-1', action: 'other' },
    { requestId: 'req-1', action: 'retry-retirement' },
    { requestId: 'req-1', action: 'checkpoint', remainingMinutes: 10 },
    { requestId: 'req-1', action: 'drain', retirementId: 'private' },
    { requestId: 'req-1\n', action: 'drain' },
  ])('rejects malformed commands with no external action %#', async (body) => {
    const { request, operations } = await fixture();
    const response = await request('/api/operations/commands', body);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'INVALID_COMMAND' });
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it('returns only the public snapshot/status fields and preserves unknown budget nulls', async () => {
    const { request } = await fixture();
    for (const [url, body, expected, status] of [
      ['/api/operations/commands', { requestId: 'req-1', action: 'drain' }, pending, 202],
      ['/api/operations/commands/req-1', undefined, pending, 200],
      ['/api/operations/status', undefined, healthy, 200],
    ] as const) {
      const response = await request(url, body);
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual(expected);
    }
  });

  it('returns no-store 404 for unknown request and 400 for malformed path request ID', async () => {
    const { request, operations } = await fixture();
    vi.spyOn(operations, 'getSnapshot').mockReturnValue(null);
    const missing = await request('/api/operations/commands/missing');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(await missing.json()).toEqual({ code: 'OPERATION_NOT_FOUND' });
    const invalid = await request('/api/operations/commands/contains%20space');
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('cache-control')).toBe('no-store');
  });

  it('exposes accepted pending then durable terminal and detects conflicting request reuse', async () => {
    const { request, run } = await fixture(true);
    const first = await request('/api/operations/commands', {
      requestId: 'real-1',
      action: 'drain',
    });
    expect(first.status).toBe(202);
    const submitted = (await first.json()) as OperationSnapshot;
    expect(submitted.status).toBe('pending');
    const fetchSnapshot = async () => {
      const response = await request('/api/operations/commands/real-1');
      return (await response.json()) as OperationSnapshot;
    };
    await expect.poll(async () => (await fetchSnapshot()).status).toBe('succeeded');
    const repeated = await request('/api/operations/commands', {
      requestId: 'real-1',
      action: 'drain',
    });
    expect(((await repeated.json()) as OperationSnapshot).operationId).toBe(submitted.operationId);
    const conflict = await request('/api/operations/commands', {
      requestId: 'real-1',
      action: 'resume',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get('cache-control')).toBe('no-store');
    expect(await conflict.json()).toEqual({ code: 'REQUEST_ID_CONFLICT' });
    expect(run).toHaveBeenCalledOnce();
  });

  it('sanitizes thrown producer failures and locks admission', async () => {
    const { request, operations, onAuditFailure } = await fixture();
    vi.spyOn(operations, 'getStatus').mockImplementation(() => {
      throw new Error('token=do-not-expose');
    });
    const response = await request('/api/operations/status');
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ code: 'OPERATIONS_UNAVAILABLE' });
    expect(onAuditFailure).toHaveBeenCalled();
  });

  it('rejects malformed producer contracts and never echoes unsafe error codes', async () => {
    const { request, operations } = await fixture();
    vi.spyOn(operations, 'getSnapshot').mockReturnValue({
      ...pending,
      status: 'failed',
      code: 'SECRET_KEY',
    });
    const snapshot = await request('/api/operations/commands/req-1');
    expect(snapshot.status).toBe(503);
    expect(await snapshot.json()).toEqual({ code: 'OPERATIONS_UNAVAILABLE' });
    vi.spyOn(operations, 'getStatus').mockReturnValue({ ...healthy, unresolvedCount: -1 });
    const status = await request('/api/operations/status');
    expect(status.status).toBe(503);
    expect(await status.json()).toEqual({ code: 'OPERATIONS_UNAVAILABLE' });
  });

  it('keeps authorization denied when its audit cannot persist and signals a lock', async () => {
    const { request, audit, onAuditFailure, operations } = await fixture();
    await audit.close();
    const response = await request('/api/operations/status', undefined, 'Bearer wrong');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' });
    expect(onAuditFailure).toHaveBeenCalled();
    expect(operations.getStatus).not.toHaveBeenCalled();
  });
});
