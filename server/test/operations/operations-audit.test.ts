import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OperationsAudit,
  fingerprintOperationsCommand,
} from '../../src/operations/OperationsAudit.js';
import { OperationJournal } from '../../src/operations/OperationJournal.js';
import { checksum } from '../../src/operations/CheckpointStore.js';
import type { OperationsCommand, OperationSnapshot } from '../../src/media/types.js';

const directories: string[] = [];
const closers: (() => Promise<void>)[] = [];
const releases: (() => void)[] = [];
const command: OperationsCommand = {
  requestId: 'req-1',
  action: 'retry-retirement',
  retirementId: 'private-identity-never-persist',
};
const pending: OperationSnapshot = {
  requestId: 'req-1',
  operationId: 'operation-1',
  action: 'retry-retirement',
  status: 'pending',
  code: null,
  updatedAtEpochMs: 1_000,
};

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const close of closers.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) {
    const resolved = path.resolve(dir);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('kkakkung-e14-audit-')
    )
      throw new Error('UNSAFE_TEST_DIRECTORY');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

async function fixture(initialize = true) {
  const opsDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kkakkung-e14-audit-'));
  directories.push(opsDataDir);
  const journal = new OperationJournal({ opsDataDir });
  await journal.restore();
  closers.push(() => journal.close());
  const options = {
    opsDataDir,
    nowEpochMs: () => 2_000,
    actorAlias: 'fixture-operator',
    isWritable: () => journal.writable,
    allowMissingHistory: () => true,
  };
  const audit = new OperationsAudit(options);
  closers.push(() => audit.close());
  if (initialize) await audit.restore();
  const file = path.join(opsDataDir, 'operations-audit.json');
  return { audit, journal, options, file };
}

function reopen(options: ConstructorParameters<typeof OperationsAudit>[0]) {
  const audit = new OperationsAudit(options);
  closers.push(() => audit.close());
  return audit;
}

async function disk(file: string) {
  return JSON.parse(await fs.readFile(file, 'utf8')) as {
    version: number;
    lastSeq: number;
    checksum: string;
    state: { entries: Record<string, unknown>[]; events: Record<string, unknown>[] };
  };
}

async function rewrite(file: string, mutate: (value: Awaited<ReturnType<typeof disk>>) => void) {
  const envelope = await disk(file);
  mutate(envelope);
  envelope.checksum = checksum({
    version: envelope.version,
    lastSeq: envelope.lastSeq,
    state: envelope.state,
  });
  await fs.writeFile(file, JSON.stringify(envelope));
}

describe('E-14 durable operation acceptance and recovery audit', () => {
  it('initializes only with explicit first-history proof and never stores the raw target', async () => {
    const { audit, file } = await fixture();
    expect(audit.writable).toBe(true);
    await audit.record(command, pending);
    await audit.record(command, pending);
    const persisted = await fs.readFile(file, 'utf8');
    expect(persisted).not.toContain('private-identity-never-persist');
    expect(audit.get(command.requestId)?.fingerprint).toBe(fingerprintOperationsCommand(command));
    expect((await disk(file)).lastSeq).toBe(2);
    await audit.record(command, { ...pending, status: 'succeeded', updatedAtEpochMs: 1_500 });
    await expect(
      audit.record(command, {
        ...pending,
        status: 'failed',
        code: 'OPERATION_FAILED',
        updatedAtEpochMs: 1_600,
      }),
    ).rejects.toThrow('AUDIT_TERMINAL_CONFLICT');
  });

  it('restores pending as durable failed RECOVERY_UNCONFIRMED and never replays it', async () => {
    const { audit, options, file } = await fixture();
    await audit.record(command, pending);
    await audit.close();
    const restored = reopen(options);
    expect(await restored.restore()).toMatchObject({
      integrity: 'ok',
      entries: [{ snapshot: { status: 'failed', code: 'RECOVERY_UNCONFIRMED' } }],
    });
    expect((await disk(file)).state.entries[0]?.snapshot).toMatchObject({ status: 'failed' });
    await expect(
      restored.record(command, { ...pending, status: 'succeeded', updatedAtEpochMs: 3_000 }),
    ).rejects.toThrow('AUDIT_TERMINAL_CONFLICT');
    expect((await restored.restore()).entries[0]?.fingerprint).toBe(
      fingerprintOperationsCommand(command),
    );
  });

  it('preserves terminal results and returns detached snapshots', async () => {
    const { audit, options, file } = await fixture();
    await audit.record(command, pending);
    await audit.record(command, { ...pending, status: 'failed', code: 'OPERATION_TIMEOUT' });
    await audit.close();
    const bytes = await fs.readFile(file, 'utf8');
    const restored = reopen(options);
    const result = await restored.restore();
    const snapshot = result.entries[0]!.snapshot as { status: string };
    snapshot.status = 'succeeded';
    expect(restored.get(command.requestId)?.snapshot.status).toBe('failed');
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  });

  it('does not roll a recovered terminal timestamp back when the epoch clock moves backward', async () => {
    const { audit, options } = await fixture();
    await audit.record(command, { ...pending, updatedAtEpochMs: 3_000 });
    await audit.close();
    const restored = reopen(options);
    expect((await restored.restore()).entries[0]?.snapshot.updatedAtEpochMs).toBe(3_000);
  });

  it('requires pending first and rejects changed target, duplicate operation ID and backward terminal time', async () => {
    const { audit } = await fixture();
    await expect(audit.record(command, { ...pending, status: 'succeeded' })).rejects.toThrow(
      'AUDIT_PENDING_REQUIRED',
    );
    await audit.record(command, pending);
    await expect(
      audit.record({ ...command, retirementId: 'other' } as OperationsCommand, pending),
    ).rejects.toThrow('AUDIT_REQUEST_CONFLICT');
    await expect(
      audit.record({ ...command, requestId: 'req-2' }, { ...pending, requestId: 'req-2' }),
    ).rejects.toThrow('DUPLICATE_AUDIT_ENTRY');
    await expect(
      audit.record(command, { ...pending, status: 'succeeded', updatedAtEpochMs: 999 }),
    ).rejects.toThrow('AUDIT_TERMINAL_CONFLICT');
    await expect(audit.record(command, { ...pending, action: 'drain' })).rejects.toThrow(
      'AUDIT_COMMAND_MISMATCH',
    );
  });

  it('captures the accepted command and snapshot before caller mutation', async () => {
    const { audit } = await fixture();
    const input = structuredClone(command) as {
      requestId: string;
      action: 'retry-retirement';
      retirementId: string;
    };
    const snapshot = structuredClone(pending) as { requestId: string } & OperationSnapshot;
    const writing = audit.record(input, snapshot);
    input.requestId = 'changed';
    input.retirementId = 'changed';
    snapshot.requestId = 'changed';
    await writing;
    expect(audit.get('req-1')?.fingerprint).toBe(fingerprintOperationsCommand(command));
    expect(audit.get('changed')).toBeNull();
  });

  it('compensates an unpublished success once, preserving the original operation ID', async () => {
    const { audit, file } = await fixture();
    await audit.record(command, pending);
    await audit.record(command, { ...pending, status: 'succeeded' });
    const failed: OperationSnapshot = {
      ...pending,
      status: 'failed',
      code: 'OPERATION_TIMEOUT',
      updatedAtEpochMs: 2_000,
    };
    await audit.invalidateUnpublishedSuccess(command, failed);
    await audit.invalidateUnpublishedSuccess(command, failed);
    expect(audit.get('req-1')?.snapshot).toEqual(failed);
    expect((await disk(file)).lastSeq).toBe(4);
    await expect(
      audit.invalidateUnpublishedSuccess(command, { ...failed, code: 'OPERATION_FAILED' }),
    ).rejects.toThrow('INVALID_AUDIT_COMPENSATION');
  });

  it('requires matching command and terminal time before compensating a success', async () => {
    const { audit } = await fixture();
    await audit.record(command, pending);
    await expect(
      audit.invalidateUnpublishedSuccess(command, {
        ...pending,
        status: 'failed',
        code: 'OPERATIONS_CLOSED',
      }),
    ).rejects.toThrow('AUDIT_TERMINAL_CONFLICT');
    await audit.record(command, { ...pending, status: 'succeeded' });
    await expect(
      audit.invalidateUnpublishedSuccess(
        { ...command, retirementId: 'other' } as OperationsCommand,
        { ...pending, status: 'failed', code: 'OPERATIONS_CLOSED' },
      ),
    ).rejects.toThrow('AUDIT_REQUEST_CONFLICT');
    await expect(
      audit.invalidateUnpublishedSuccess(command, {
        ...pending,
        status: 'failed',
        code: 'OPERATIONS_CLOSED',
        updatedAtEpochMs: 999,
      }),
    ).rejects.toThrow('AUDIT_TERMINAL_CONFLICT');
  });
});

describe('E-14 audit secret exclusion and strict storage schema', () => {
  it('captures compensation scope before the caller can change its request', async () => {
    const { audit } = await fixture();
    await audit.record(command, pending);
    await audit.record(command, { ...pending, status: 'succeeded' });
    const input = { ...command };
    const correcting = audit.invalidateUnpublishedSuccess(input, {
      ...pending,
      status: 'failed',
      code: 'OPERATIONS_CLOSED',
    });
    input.requestId = 'changed';
    await correcting;
    expect(audit.get('req-1')?.snapshot.status).toBe('failed');
    expect(audit.get('changed')).toBeNull();
  });

  it('stores safe rejection and lock events while discarding auth-failure and invalid request data', async () => {
    const { audit, file } = await fixture();
    await audit.recordEvent({
      kind: 'rejected',
      code: 'REQUEST_ID_CONFLICT',
      command,
      operationId: 'operation-1',
    });
    await audit.recordEvent({
      kind: 'locked',
      code: 'OPERATION_TIMEOUT',
      command,
      operationId: 'operation-1',
    });
    await audit.recordEvent({
      kind: 'auth-failed',
      code: 'UNAUTHORIZED',
      command: {
        requestId: 'attacker-input-never-saved',
        action: 'drain',
      },
      operationId: 'attacker-input-never-saved',
    });
    await audit.recordEvent({
      kind: 'rejected',
      code: 'INVALID_COMMAND',
      command: {
        requestId: 'attacker-input-never-saved',
        action: 'drain',
        token: 'private-token-never-saved',
      } as OperationsCommand,
      operationId: 'attacker-input-never-saved',
    });
    const persisted = await fs.readFile(file, 'utf8');
    expect(persisted).not.toMatch(/private-|attacker-input/);
    const events = (await disk(file)).state.events;
    expect(events[0]).toMatchObject({
      actorAlias: 'fixture-operator',
      requestId: 'req-1',
      action: 'retry-retirement',
      resultCode: 'REQUEST_ID_CONFLICT',
    });
    expect(events.slice(2)).toEqual([
      expect.objectContaining({ requestId: null, operationId: null, action: null }),
      expect.objectContaining({ requestId: null, operationId: null, action: null }),
    ]);
  });

  it('rejects unknown fields and arbitrary error strings instead of persisting them', async () => {
    const { audit } = await fixture();
    expect(() =>
      audit.record({ ...command, token: 'private' } as OperationsCommand, pending),
    ).toThrow('INVALID_SCHEMA');
    expect(() =>
      audit.record(command, { ...pending, status: 'failed', code: 'SECRET_KEY' }),
    ).toThrow('INVALID_AUDIT_SNAPSHOT');
    expect(() =>
      audit.record(command, { ...pending, status: 'failed', code: 'contains token=secret' }),
    ).toThrow('INVALID_AUDIT_SNAPSHOT');
    await expect(
      audit.recordEvent({ kind: 'locked', code: 'SECRET_KEY' as 'OPERATION_FAILED' }),
    ).rejects.toThrow('INVALID_AUDIT_EVENT');
  });

  it.each(['req\n', 'req\r\n', 'contains space', '../private', 'x'.repeat(129)])(
    'rejects malformed request ID %#',
    async (requestId) => {
      const { audit } = await fixture();
      expect(() => audit.record({ ...command, requestId }, { ...pending, requestId })).toThrow(
        'INVALID_AUDIT_COMMAND',
      );
    },
  );

  it.each([
    (state: Awaited<ReturnType<typeof disk>>) => {
      state.state.entries.push(state.state.entries[0]!);
    },
    (state: Awaited<ReturnType<typeof disk>>) => {
      state.state.entries[0]!.token = 'forbidden';
    },
    (state: Awaited<ReturnType<typeof disk>>) => {
      state.state.entries[0]!.fingerprint = 'a'.repeat(64) + '\n';
    },
    (state: Awaited<ReturnType<typeof disk>>) => {
      state.state.entries[0]!.actorAlias = 'operator\n';
    },
    (state: Awaited<ReturnType<typeof disk>>) => {
      (state.state.entries[0]!.snapshot as Record<string, unknown>).status = 'arbitrary';
    },
    (state: Awaited<ReturnType<typeof disk>>) => {
      (state.state.entries[0]!.snapshot as Record<string, unknown>).updatedAtEpochMs = -1;
    },
    (state: Awaited<ReturnType<typeof disk>>) => {
      state.state.events.push({
        actorAlias: 'operator',
        kind: 'auth-failed',
        requestId: 'attacker',
        operationId: null,
        action: 'drain',
        resultCode: 'UNAUTHORIZED',
        atEpochMs: 1,
      });
    },
  ])('keeps tampered but checksummed schema evidence intact and locked %#', async (mutate) => {
    const { audit, options, file } = await fixture();
    await audit.record(command, pending);
    await audit.close();
    await rewrite(file, mutate);
    const evidence = await fs.readFile(file, 'utf8');
    const restored = reopen(options);
    expect((await restored.restore()).integrity).toBe('corrupt');
    expect(restored.writable).toBe(false);
    await expect(restored.record(command, pending)).rejects.toThrow('AUDIT_NOT_READY');
    expect(await fs.readFile(file, 'utf8')).toBe(evidence);
  });
});

describe('E-14 audit history and shared writer lifecycle', () => {
  it('defaults missing history to locked without writing an empty replacement', async () => {
    const { audit, options, file } = await fixture(false);
    await audit.close();
    const restored = reopen({ ...options, allowMissingHistory: undefined });
    expect(await restored.restore()).toMatchObject({ integrity: 'missing', entries: [] });
    expect(restored.writable).toBe(false);
    await expect(restored.record(command, pending)).rejects.toThrow('AUDIT_NOT_READY');
    await expect(fs.readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cannot use a later change of proof to reinitialize an already restored missing history', async () => {
    const { audit, options, file } = await fixture(false);
    await audit.close();
    let allowed = false;
    const restored = reopen({ ...options, allowMissingHistory: () => allowed });
    expect((await restored.restore()).integrity).toBe('missing');
    allowed = true;
    expect((await restored.restore()).integrity).toBe('missing');
    await expect(fs.readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails pending recovery closed when its required terminal write fails', async () => {
    const { audit, options, file } = await fixture();
    await audit.record(command, pending);
    await audit.close();
    const evidence = await fs.readFile(file, 'utf8');
    const restored = reopen({ ...options, isWritable: () => false });
    await expect(restored.restore()).rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(restored.writable).toBe(false);
    await expect(restored.record(command, pending)).rejects.toThrow('AUDIT_NOT_READY');
    expect(await fs.readFile(file, 'utf8')).toBe(evidence);
  });

  it('does not admit a journal writer conflict and cannot write after lease loss', async () => {
    const { audit, journal, options } = await fixture();
    const rival = new OperationJournal({ opsDataDir: options.opsDataDir });
    closers.push(() => rival.close());
    expect(await rival.restore()).toMatchObject({ writable: false, reason: 'WRITER_CONFLICT' });
    const rejected = reopen({ ...options, isWritable: () => rival.writable });
    await rejected.restore();
    expect(rejected.writable).toBe(false);
    await expect(rejected.record(command, pending)).rejects.toThrow('AUDIT_WRITE_FAILED');
    await journal.close();
    expect(audit.writable).toBe(false);
    await expect(audit.record(command, pending)).rejects.toThrow('AUDIT_WRITE_FAILED');
  });

  it('seals synchronously and drains both accepted writes before releasing the journal lease', async () => {
    const { audit, journal, options, file } = await fixture();
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.push(release);
    const rename = fs.rename.bind(fs);
    let first = true;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (first && String(target) === file) {
        first = false;
        entered();
        await gate;
      }
      await rename(source, target);
    });
    const accepted = audit.record(command, pending);
    await reached;
    const terminal = audit.record(command, {
      ...pending,
      status: 'failed',
      code: 'OPERATIONS_CLOSED',
    });
    const closing = audit.close();
    expect(audit.close()).toBe(closing);
    expect(audit.writable).toBe(false);
    await expect(audit.record(command, pending)).rejects.toThrow('OPERATIONS_CLOSED');
    await expect(audit.recordEvent({ kind: 'locked', code: 'OPERATIONS_CLOSED' })).rejects.toThrow(
      'OPERATIONS_CLOSED',
    );
    const rival = new OperationJournal({ opsDataDir: options.opsDataDir });
    closers.push(() => rival.close());
    expect(await rival.restore()).toMatchObject({ writable: false, reason: 'WRITER_CONFLICT' });
    expect(journal.writable).toBe(true);
    release();
    await Promise.all([accepted, terminal, closing]);
    expect((await disk(file)).state.entries[0]?.snapshot).toMatchObject({ status: 'failed' });
    await journal.close();
    const next = new OperationJournal({ opsDataDir: options.opsDataDir });
    closers.push(() => next.close());
    expect((await next.restore()).writable).toBe(true);
  });
});
