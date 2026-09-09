import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OperationsCommand,
  OperationsStatus,
  OperationSnapshot,
} from '../../src/media/types.js';
import { OperationsAudit } from '../../src/operations/OperationsAudit.js';
import {
  OperationsController,
  parseOperationsCommand,
  isOperationsRequestId,
  type OperationsControllerOptions,
} from '../../src/operations/OperationsController.js';

const controllers: OperationsController[] = [];
afterEach(async () => {
  await Promise.allSettled(controllers.splice(0).map((controller) => controller.close()));
  vi.useRealTimers();
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function fixture(overrides: Partial<OperationsControllerOptions> = {}, initialize = true) {
  let elapsed = 0;
  let epoch = 1_000_000;
  let admission: OperationsStatus['admission'] = 'OPEN';
  let ready = true;
  const changes: OperationsStatus['admission'][] = [];
  const auditStore = new OperationsAudit({
    opsDataDir: path.resolve('synthetic-audit-not-used'),
    nowEpochMs: () => epoch,
    isWritable: () => true,
    allowMissingHistory: () => true,
  });
  const restore = vi
    .spyOn(auditStore, 'restore')
    .mockResolvedValue({ integrity: 'ok', entries: [] });
  const record = vi.spyOn(auditStore, 'record').mockResolvedValue();
  const compensate = vi.spyOn(auditStore, 'invalidateUnpublishedSuccess').mockResolvedValue();
  const event = vi.spyOn(auditStore, 'recordEvent').mockResolvedValue();
  const auditClose = vi.spyOn(auditStore, 'close').mockResolvedValue();
  const run = vi.fn<OperationsControllerOptions['run']>(async () => {});
  const deps: OperationsControllerOptions = {
    nowEpochMs: () => epoch,
    monotonicNow: () => elapsed,
    timeoutMs: 1_000,
    setAdmission: (value) => {
      admission = value;
      changes.push(value);
    },
    getStatus: () => ({
      admission,
      readiness: ready ? 'READY' : 'LOCKED',
      unresolvedCount: 0,
      remainingMinutes: 10,
      remainingBytes: 100,
      checkedAtEpochMs: 1_000_000,
    }),
    canResume: () => ready,
    run,
    auditStore,
    ...overrides,
  };
  const controller = new OperationsController(deps);
  controllers.push(controller);
  if (initialize) await controller.initializeAudit();
  return {
    controller,
    deps,
    run,
    record,
    compensate,
    event,
    restore,
    auditClose,
    changes,
    setElapsed: (value: number) => {
      elapsed = value;
    },
    setEpoch: (value: number) => {
      epoch = value;
    },
    setReady: (value: boolean) => {
      ready = value;
    },
    setAdmission: (value: OperationsStatus['admission']) => {
      admission = value;
    },
    advance: async (ms: number) => {
      elapsed += ms;
      epoch += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

async function removeFixture(directory: string) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith('kkakkung-e14-controller-')
  )
    throw new Error('UNSAFE_TEST_CLEANUP');
  await rm(resolved, { recursive: true, force: true });
}

describe('strict operation command schema', () => {
  it.each([
    null,
    [],
    1,
    'drain',
    {},
    { requestId: 'x', action: 'smoke' },
    { requestId: 'x', action: new String('drain') },
    { requestId: '', action: 'drain' },
    { requestId: 'x\n', action: 'drain' },
    { requestId: 'x y', action: 'drain' },
    { requestId: 'x'.repeat(129), action: 'drain' },
    { requestId: 'x', action: 'checkpoint', remainingMinutes: 99 },
    { requestId: 'x', action: 'drain', retirementId: 'retire' },
    { requestId: 'x', action: 'resume', retirementId: undefined },
    { requestId: 'x', action: 'retry-retirement' },
    { requestId: 'x', action: 'retry-retirement', retirementId: null },
    { requestId: 'x', action: 'retry-retirement', retirementId: 'retire\n' },
    Object.assign(Object.create({ hidden: 'value' }) as object, {
      requestId: 'x',
      action: 'drain',
    }),
    { requestId: 'x', action: 'drain', [Symbol('secret')]: 'not-accepted' },
  ])('rejects invalid body without accepting extra authority %#', (input) => {
    expect(() => parseOperationsCommand(input)).toThrow('INVALID_COMMAND');
  });

  it('rejects accessors without evaluating them and accepts only copied data properties', () => {
    const getter = vi.fn(() => 'x');
    const input = { action: 'drain' };
    Object.defineProperty(input, 'requestId', { get: getter, enumerable: true });
    expect(() => parseOperationsCommand(input)).toThrow('INVALID_COMMAND');
    expect(getter).not.toHaveBeenCalled();
    const hidden = { requestId: 'x', action: 'drain' };
    Object.defineProperty(hidden, 'secret', { value: 'private' });
    expect(() => parseOperationsCommand(hidden)).toThrow('INVALID_COMMAND');
    const raw = { requestId: 'valid._:-1', action: 'retry-retirement', retirementId: 'r-1' };
    const parsed = parseOperationsCommand(raw);
    raw.retirementId = 'changed';
    expect(parsed).toEqual({
      requestId: 'valid._:-1',
      action: 'retry-retirement',
      retirementId: 'r-1',
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(isOperationsRequestId('bad\n')).toBe(false);
  });
});

describe('durable operation queue', () => {
  it('requires successful audit recovery before accepting work or changing admission', async () => {
    const f = await fixture({}, false);
    expect(() => f.controller.submit({ requestId: 'x', action: 'drain' })).toThrow(
      'OPERATIONS_NOT_INITIALIZED',
    );
    expect(f.changes).toEqual([]);
    expect(f.run).not.toHaveBeenCalled();
    await f.controller.initializeAudit();
    expect(f.changes).toEqual(['DRAINING']);
  });

  it('drains synchronously, deduplicates by request/body and persists conflicts without another execution', async () => {
    const f = await fixture();
    f.setAdmission('OPEN');
    const active = gate();
    f.run.mockImplementation(() => active.promise);
    const command = { requestId: 'drain-1', action: 'drain' } as const;
    const first = f.controller.submit(command);
    expect(f.controller.getStatus().admission).toBe('DRAINING');
    expect(first).toMatchObject({ status: 'accepted', snapshot: { status: 'pending' } });
    expect(f.controller.submit(command)).toEqual(first);
    expect(f.controller.submit({ requestId: 'drain-1', action: 'resume' })).toEqual({
      status: 'conflict',
      code: 'REQUEST_ID_CONFLICT',
    });
    await flush();
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot('drain-1')?.status).toBe('pending');
    active.resolve();
    await flush();
    expect(f.controller.getSnapshot('drain-1')?.status).toBe('succeeded');
    expect(f.controller.getStatus().admission).toBe('DRAINING');
    expect(f.event).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rejected', code: 'REQUEST_ID_CONFLICT' }),
    );
  });

  it('includes retry target in idempotence and never retains mutable command/snapshot fields', async () => {
    const f = await fixture();
    const command = {
      requestId: 'retry',
      action: 'retry-retirement',
      retirementId: 'r-1',
    } as const;
    const first = f.controller.submit(command);
    expect(f.controller.submit({ ...command, retirementId: 'r-2' }).status).toBe('conflict');
    const returned = first.status === 'accepted' ? first.snapshot : null;
    if (returned) (returned as { status: string }).status = 'succeeded';
    expect(f.controller.getSnapshot('retry')?.status).toBe('pending');
    await flush();
    expect(f.run.mock.calls[0]?.[0]).toEqual(command);
    const exposed = f.controller.getSnapshot('retry');
    if (exposed) (exposed as { code: string | null }).code = 'private';
    expect(f.controller.getSnapshot('retry')?.code).toBeNull();
  });

  it('requires durable pending before backend execution and durable success before OPEN', async () => {
    const f = await fixture();
    const pending = gate();
    const terminal = gate();
    f.record.mockImplementation(async (_command, state) => {
      await (state.status === 'pending' ? pending.promise : terminal.promise);
    });
    f.controller.submit({ requestId: 'resume', action: 'resume' });
    await flush();
    expect(f.record).toHaveBeenCalledTimes(1);
    expect(f.run).not.toHaveBeenCalled();
    pending.resolve();
    await flush();
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot('resume')?.status).toBe('pending');
    expect(f.changes).not.toContain('OPEN');
    terminal.resolve();
    await flush();
    expect(f.controller.getSnapshot('resume')?.status).toBe('succeeded');
    expect(f.changes.at(-1)).toBe('OPEN');
  });

  it('executes accepted commands in order instead of overlapping their side effects', async () => {
    const f = await fixture();
    const first = gate();
    f.run.mockImplementationOnce(() => first.promise);
    f.controller.submit({ requestId: 'one', action: 'checkpoint' });
    f.controller.submit({ requestId: 'two', action: 'checkpoint' });
    await flush();
    expect(f.run).toHaveBeenCalledTimes(1);
    first.resolve();
    await flush();
    expect(f.run.mock.calls.map(([command]) => command.requestId)).toEqual(['one', 'two']);
    expect(f.controller.getSnapshot('two')?.status).toBe('succeeded');
  });

  it('sanitizes backend exceptions and leaves admission closed after failure', async () => {
    const f = await fixture();
    f.setAdmission('OPEN');
    f.run.mockRejectedValue(new Error('apiSecret=private-fixture'));
    f.controller.submit({ requestId: 'failure', action: 'checkpoint' });
    await flush();
    expect(f.controller.getSnapshot('failure')).toMatchObject({
      status: 'failed',
      code: 'OPERATION_FAILED',
    });
    expect(f.controller.getStatus().admission).toBe('DRAINING');
    expect(JSON.stringify(f.record.mock.calls)).not.toContain('private-fixture');
  });

  it('rejects invalid submissions without constructing an operation or recording body secrets', async () => {
    const f = await fixture();
    expect(() =>
      f.controller.submit({
        requestId: 'x',
        action: 'checkpoint',
        apiSecret: 'secret-body',
      } as OperationsCommand),
    ).toThrow('INVALID_COMMAND');
    await flush();
    expect(f.controller.getSnapshot('x')).toBeNull();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.event).toHaveBeenCalledWith({
      kind: 'rejected',
      code: 'INVALID_COMMAND',
      command: undefined,
      operationId: undefined,
    });
    expect(JSON.stringify(f.event.mock.calls)).not.toContain('secret-body');
  });

  it('publishes only status allowlist fields and isolates returned objects', async () => {
    const privateStatus = {
      admission: 'DRAINING',
      readiness: 'READY',
      unresolvedCount: 2,
      remainingMinutes: null,
      remainingBytes: 10,
      checkedAtEpochMs: null,
      apiSecret: 'private',
      identities: ['hidden'],
    } as const;
    const f = await fixture({ getStatus: () => privateStatus });
    expect(f.controller.getStatus()).toEqual({
      admission: 'DRAINING',
      readiness: 'READY',
      unresolvedCount: 2,
      remainingMinutes: null,
      remainingBytes: 10,
      checkedAtEpochMs: null,
    });
    const output = f.controller.getStatus();
    (output as { remainingBytes: number | null }).remainingBytes = 999;
    expect(f.controller.getStatus().remainingBytes).toBe(10);
    expect(JSON.stringify(output)).not.toContain('hidden');
  });

  it('returns a fail-closed status for invalid internal numeric evidence', async () => {
    const f = await fixture({
      getStatus: () => ({
        admission: 'OPEN',
        readiness: 'READY',
        unresolvedCount: -1,
        remainingMinutes: NaN,
        remainingBytes: Infinity,
        checkedAtEpochMs: 1,
      }),
    });
    expect(f.controller.getStatus()).toEqual({
      admission: 'LOCKED',
      readiness: 'LOCKED',
      unresolvedCount: 0,
      remainingMinutes: null,
      remainingBytes: null,
      checkedAtEpochMs: null,
    });
  });

  it('does not expose internal evidence-provider exceptions in public status', async () => {
    const f = await fixture({
      getStatus: () => {
        throw new Error('private-journal-path');
      },
    });
    expect(f.controller.getStatus()).toEqual({
      admission: 'LOCKED',
      readiness: 'LOCKED',
      unresolvedCount: 0,
      remainingMinutes: null,
      remainingBytes: null,
      checkedAtEpochMs: null,
    });
  });

  it('preserves an existing LOCKED admission when drain and timeout happen', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    f.setAdmission('LOCKED');
    f.run.mockImplementation(() => new Promise<void>(() => {}));
    f.controller.submit({ requestId: 'locked', action: 'drain' });
    await flush();
    await f.advance(1_000);
    expect(f.controller.getStatus().admission).toBe('LOCKED');
  });

  it('clamps optimistic injected status before initialization and after shutdown', async () => {
    const optimistic = () => ({
      admission: 'OPEN' as const,
      readiness: 'READY' as const,
      unresolvedCount: 0,
      remainingMinutes: 1,
      remainingBytes: 1,
      checkedAtEpochMs: 1,
    });
    const f = await fixture({ getStatus: optimistic, setAdmission: () => {} }, false);
    expect(f.controller.getStatus()).toMatchObject({
      admission: 'DRAINING',
      readiness: 'RECOVERING',
    });
    await f.controller.initializeAudit();
    expect(f.controller.getStatus()).toMatchObject({ admission: 'OPEN', readiness: 'READY' });
    await f.controller.close();
    expect(f.controller.getStatus()).toMatchObject({ admission: 'DRAINING', readiness: 'LOCKED' });
  });

  it('clamps optimistic injected status after an audit failure', async () => {
    const f = await fixture({
      getStatus: () => ({
        admission: 'OPEN',
        readiness: 'READY',
        unresolvedCount: 0,
        remainingMinutes: 1,
        remainingBytes: 1,
        checkedAtEpochMs: 1,
      }),
      setAdmission: () => {},
    });
    f.record.mockRejectedValue(new Error('audit-unavailable'));
    f.controller.submit({ requestId: 'fault-status', action: 'checkpoint' });
    await flush();
    expect(f.controller.getStatus()).toMatchObject({ admission: 'LOCKED', readiness: 'LOCKED' });
  });
});

describe('operation reception deadline and stale completion fences', () => {
  it('expires queued work from submission without dispatching it after its deadline', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    f.run.mockImplementationOnce(() => new Promise<void>(() => {}));
    f.controller.submit({ requestId: 'blocked', action: 'checkpoint' });
    f.controller.submit({ requestId: 'queued', action: 'checkpoint' });
    await flush();
    await f.advance(1_000);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot('queued')).toMatchObject({
      status: 'failed',
      code: 'OPERATION_TIMEOUT',
    });
    expect(
      f.record.mock.calls.some(
        ([command, state]) => command.requestId === 'queued' && state.status === 'failed',
      ),
    ).toBe(true);
  });

  it('releases the queue after timeout without waiting for an uncooperative remote promise', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    f.run.mockImplementationOnce(() => new Promise<void>(() => {}));
    f.controller.submit({ requestId: 'hung', action: 'checkpoint' });
    await flush();
    await f.advance(100);
    f.controller.submit({ requestId: 'next', action: 'checkpoint' });
    await f.advance(900);
    expect(f.controller.getSnapshot('hung')?.code).toBe('OPERATION_TIMEOUT');
    expect(f.controller.getSnapshot('next')?.status).toBe('succeeded');
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('checks monotonic time after await even when the timer callback has not run', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const backend = gate();
    f.run.mockImplementation(() => backend.promise);
    f.controller.submit({ requestId: 'late', action: 'resume' });
    await flush();
    f.setElapsed(1_000);
    backend.resolve();
    await flush();
    expect(f.controller.getSnapshot('late')).toMatchObject({
      status: 'failed',
      code: 'OPERATION_TIMEOUT',
    });
    expect(f.changes).not.toContain('OPEN');
  });

  it('polling and duplicate submission expose expiry while the timer is delayed', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    f.run.mockImplementation(() => new Promise<void>(() => {}));
    const command = { requestId: 'poll-expiry', action: 'checkpoint' } as const;
    f.controller.submit(command);
    await flush();
    f.setElapsed(1_000);
    expect(f.controller.submit(command)).toMatchObject({
      status: 'accepted',
      snapshot: { status: 'failed', code: 'OPERATION_TIMEOUT' },
    });
    expect(f.controller.getSnapshot(command.requestId)?.status).toBe('failed');
  });

  it('gives the backend a fresh dispatch fence instead of relying on eventual signal delivery', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const backend = gate();
    let beforeDispatch!: () => boolean;
    let signal!: AbortSignal;
    f.run.mockImplementation(async (_command, activeSignal, activeFence) => {
      signal = activeSignal;
      beforeDispatch = activeFence;
      await backend.promise;
    });
    f.controller.submit({ requestId: 'dispatch-fence', action: 'checkpoint' });
    await flush();
    expect(beforeDispatch()).toBe(true);
    f.setElapsed(1_000);
    expect(signal.aborted).toBe(false);
    expect(beforeDispatch()).toBe(false);
    expect(signal.aborted).toBe(true);
    backend.resolve();
    await flush();
    expect(f.controller.getSnapshot('dispatch-fence')?.code).toBe('OPERATION_TIMEOUT');
  });

  it.each([NaN, -1])(
    'fails closed when monotonic evidence becomes invalid (%s)',
    async (invalid) => {
      vi.useFakeTimers();
      const f = await fixture();
      const backend = gate();
      f.run.mockImplementation(() => backend.promise);
      f.controller.submit({ requestId: 'clock', action: 'checkpoint' });
      await flush();
      f.setElapsed(invalid);
      backend.resolve();
      await flush();
      expect(f.controller.getSnapshot('clock')?.code).toBe('INVALID_OPERATION_CLOCK');
      expect(f.controller.getStatus().admission).toBe('LOCKED');
    },
  );

  it('uses monotonic deadlines when epoch time jumps and never regresses audit timestamps', async () => {
    const f = await fixture();
    f.setEpoch(1);
    f.controller.submit({ requestId: 'backward-wall', action: 'checkpoint' });
    await flush();
    expect(f.controller.getSnapshot('backward-wall')).toMatchObject({
      status: 'succeeded',
      updatedAtEpochMs: 1_000_000,
    });
    f.setEpoch(9_000_000_000);
    f.controller.submit({ requestId: 'forward-wall', action: 'checkpoint' });
    await flush();
    expect(f.controller.getSnapshot('forward-wall')?.status).toBe('succeeded');
  });

  it.each(['drain', 'timeout', 'close', 'readiness'] as const)(
    'cannot reopen after %s during successful resume audit write',
    async (cause) => {
      vi.useFakeTimers();
      const f = await fixture();
      const terminal = gate();
      f.record.mockImplementation(async (command, state) => {
        if (command.requestId === 'resume' && state.status === 'succeeded') await terminal.promise;
      });
      f.controller.submit({ requestId: 'resume', action: 'resume' });
      await flush();
      expect(f.record).toHaveBeenCalledTimes(2);
      if (cause === 'drain') f.controller.submit({ requestId: 'new-drain', action: 'drain' });
      if (cause === 'timeout') f.setElapsed(1_000);
      if (cause === 'close') void f.controller.close();
      if (cause === 'readiness') f.setReady(false);
      terminal.resolve();
      await flush();
      expect(f.changes).not.toContain('OPEN');
      expect(f.controller.getSnapshot('resume')?.status).toBe('failed');
      expect(f.compensate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, 'throw'] as const)(
    'rechecks final drain evidence after durable terminal write (%s)',
    async (newEvidence) => {
      let complete = true;
      const f = await fixture({
        canComplete: () => {
          if (!complete && newEvidence === 'throw') throw new Error('private-evidence');
          return complete;
        },
      });
      const terminal = gate();
      f.record.mockImplementation(async (_command, state) => {
        if (state.status === 'succeeded') await terminal.promise;
      });
      f.controller.submit({ requestId: 'drain-final', action: 'drain' });
      await flush();
      complete = false;
      terminal.resolve();
      await flush();
      expect(f.controller.getSnapshot('drain-final')).toMatchObject({
        status: 'failed',
        code: 'OPERATION_UNCONFIRMED',
      });
      expect(f.compensate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: 'OPERATION_UNCONFIRMED' }),
      );
    },
  );

  it('does not let an older resume overtake a newer drain submission', async () => {
    const f = await fixture();
    const backend = gate();
    f.run.mockImplementationOnce(() => backend.promise);
    f.controller.submit({ requestId: 'old-resume', action: 'resume' });
    await flush();
    f.controller.submit({ requestId: 'new-drain', action: 'drain' });
    backend.resolve();
    await flush();
    expect(f.controller.getSnapshot('old-resume')?.code).toBe('RESUME_NOT_READY');
    expect(f.controller.getSnapshot('new-drain')?.status).toBe('succeeded');
    expect(f.changes).not.toContain('OPEN');
  });
});

describe('audit failures, shutdown and restart', () => {
  it.each(['missing', 'corrupt'] as const)(
    'rejects %s audit history without accepting operations',
    async (integrity) => {
      const f = await fixture({}, false);
      f.restore.mockResolvedValue({ integrity, entries: [] });
      await expect(f.controller.initializeAudit()).rejects.toThrow('OPERATIONS_AUDIT_CORRUPT');
      expect(f.controller.getStatus().admission).toBe('LOCKED');
      expect(() => f.controller.submit({ requestId: 'x', action: 'checkpoint' })).toThrow(
        'OPERATIONS_NOT_INITIALIZED',
      );
      expect(f.run).not.toHaveBeenCalled();
    },
  );

  it.each(['pending', 'succeeded'] as const)(
    'locks on %s write failure and never advertises success or OPEN',
    async (failureStatus) => {
      const f = await fixture();
      f.record.mockImplementation(async (_command, state) => {
        if (state.status === failureStatus) throw new Error('disk-path-private');
      });
      f.controller.submit({ requestId: 'write-failure', action: 'resume' });
      await flush();
      expect(f.controller.getSnapshot('write-failure')).toMatchObject({
        status: 'failed',
        code: 'AUDIT_WRITE_FAILED',
      });
      expect(f.controller.getStatus().admission).toBe('LOCKED');
      expect(f.changes).not.toContain('OPEN');
      expect(f.run).toHaveBeenCalledTimes(failureStatus === 'pending' ? 0 : 1);
    },
  );

  it('locks on failed compensation and never revives an unpublished success', async () => {
    const f = await fixture();
    const terminal = gate();
    f.record.mockImplementation(async (_command, state) => {
      if (state.status === 'succeeded') await terminal.promise;
    });
    f.compensate.mockRejectedValue(new Error('disk-full-private'));
    f.controller.submit({ requestId: 'compensation', action: 'resume' });
    await flush();
    f.setReady(false);
    terminal.resolve();
    await flush();
    expect(f.controller.getSnapshot('compensation')?.status).toBe('failed');
    expect(f.controller.getStatus().admission).toBe('LOCKED');
    expect(f.changes).not.toContain('OPEN');
  });

  it('locks and cancels an in-flight command if a rejection audit cannot be persisted', async () => {
    const f = await fixture();
    const backend = gate();
    f.run.mockImplementation(() => backend.promise);
    f.controller.submit({ requestId: 'active', action: 'resume' });
    await flush();
    f.event.mockRejectedValue(new Error('audit-offline'));
    expect(() =>
      f.controller.submit({ requestId: 'bad', action: 'smoke' } as unknown as OperationsCommand),
    ).toThrow('INVALID_COMMAND');
    await flush();
    backend.resolve();
    await flush();
    expect(f.controller.getSnapshot('active')?.code).toBe('AUDIT_WRITE_FAILED');
    expect(f.controller.getStatus().admission).toBe('LOCKED');
    expect(f.changes).not.toContain('OPEN');
  });

  it('close aborts a hanging backend and drains its failure audit without waiting for the backend', async () => {
    const f = await fixture();
    f.run.mockImplementation(() => new Promise<void>(() => {}));
    f.controller.submit({ requestId: 'hang', action: 'checkpoint' });
    await flush();
    await f.controller.close();
    expect(f.controller.getSnapshot('hang')).toMatchObject({
      status: 'failed',
      code: 'OPERATIONS_CLOSED',
    });
    expect(f.record.mock.calls.at(-1)?.[1].status).toBe('failed');
    expect(f.auditClose).toHaveBeenCalledTimes(1);
    expect(f.run.mock.calls[0]?.[1].aborted).toBe(true);
    expect(() => f.controller.submit({ requestId: 'new', action: 'checkpoint' })).toThrow(
      'OPERATIONS_CLOSED',
    );
    await f.controller.close();
    expect(f.auditClose).toHaveBeenCalledTimes(1);
  });

  it('close holds the audit open until an already accepted pending write and failure both drain', async () => {
    const f = await fixture();
    const pending = gate();
    f.record.mockImplementation(async (_command, state) => {
      if (state.status === 'pending') await pending.promise;
    });
    f.controller.submit({ requestId: 'pending-write', action: 'checkpoint' });
    await flush();
    const closing = f.controller.close();
    await flush();
    expect(f.auditClose).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
    pending.resolve();
    await closing;
    expect(f.record.mock.calls.map(([, state]) => state.status)).toEqual(['pending', 'failed']);
    expect(f.auditClose).toHaveBeenCalledTimes(1);
  });

  it('close during restore never re-enables submission', async () => {
    const f = await fixture({}, false);
    const restoring = gate();
    f.restore.mockImplementation(async () => {
      await restoring.promise;
      return { integrity: 'ok', entries: [] };
    });
    const initialization = f.controller.initializeAudit();
    const asserted = expect(initialization).rejects.toThrow('OPERATIONS_CLOSED');
    const closing = f.controller.close();
    restoring.resolve();
    await asserted;
    await closing;
    expect(() => f.controller.submit({ requestId: 'new', action: 'checkpoint' })).toThrow(
      'OPERATIONS_NOT_INITIALIZED',
    );
  });

  it('a throwing optional observer cannot change the durable terminal result', async () => {
    const f = await fixture({
      audit: () => {
        throw new Error('observer-only');
      },
    });
    f.controller.submit({ requestId: 'observer', action: 'checkpoint' });
    await flush();
    expect(f.controller.getSnapshot('observer')?.status).toBe('succeeded');
  });

  it('restores terminal idempotence from disk and converts abandoned pending to durable failure', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'kkakkung-e14-controller-restart-'));
    const stores: OperationsAudit[] = [];
    const makeStore = () => {
      const audit = new OperationsAudit({
        opsDataDir: directory,
        nowEpochMs: () => 1_000_000,
        isWritable: () => true,
        allowMissingHistory: () => true,
      });
      stores.push(audit);
      return audit;
    };
    try {
      const f = await fixture({ auditStore: makeStore() });
      f.controller.submit({ requestId: 'once', action: 'checkpoint' });
      await vi.waitFor(() => expect(f.controller.getSnapshot('once')?.status).toBe('succeeded'));
      const operationId = f.controller.getSnapshot('once')?.operationId;
      await f.controller.close();
      const interruptedStore = makeStore();
      await interruptedStore.restore();
      const interrupted: OperationSnapshot = {
        requestId: 'abandoned',
        operationId: 'abandoned-operation',
        action: 'resume',
        status: 'pending',
        code: null,
        updatedAtEpochMs: 1_000_000,
      };
      await interruptedStore.record({ requestId: 'abandoned', action: 'resume' }, interrupted);
      await interruptedStore.close();
      const next = await fixture({ auditStore: makeStore() });
      expect(next.controller.submit({ requestId: 'once', action: 'checkpoint' })).toMatchObject({
        status: 'accepted',
        snapshot: { operationId, status: 'succeeded' },
      });
      expect(next.controller.submit({ requestId: 'once', action: 'drain' }).status).toBe(
        'conflict',
      );
      expect(next.controller.submit({ requestId: 'abandoned', action: 'resume' })).toMatchObject({
        status: 'accepted',
        snapshot: { status: 'failed', code: 'RECOVERY_UNCONFIRMED' },
      });
      expect(next.run).not.toHaveBeenCalled();
      expect(next.controller.getStatus().admission).toBe('DRAINING');
      await next.controller.close();
      expect(await readFile(path.join(directory, 'operations-audit.json'), 'utf8')).toContain(
        'RECOVERY_UNCONFIRMED',
      );
    } finally {
      await Promise.allSettled(stores.map((store) => store.close()));
      await removeFixture(directory);
    }
  });
});
