import { describe, expect, it, vi } from 'vitest';

import { createSessionRuntime } from './SessionRuntime';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

const session = { token: 'once', expiresAt: 1_800_000_000_000 };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('createSessionRuntime', () => {
  it('leaves a room when an obsolete join resolves', async () => {
    const first = deferred<{ leave: () => Promise<void> }>();
    const pendingSession = deferred<{ token: string; expiresAt: number }>();
    const activate = vi.fn();
    const leave = vi.fn(async () => undefined);
    const joinRoom = vi.fn(() => first.promise);
    const runtime = createSessionRuntime({
      createDevSession: vi.fn(() => pendingSession.promise),
      joinRoom,
    });

    const joining = runtime.join('해솔');
    pendingSession.resolve(session);
    await vi.waitFor(() => expect(joinRoom).toHaveBeenCalledOnce());
    await runtime.disconnect();
    first.resolve({ activate, leave });
    await joining;

    expect(leave).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().status).toBe('idle');
  });

  it('replaces a connected room without retaining the previous room', async () => {
    const firstActivate = vi.fn();
    const firstLeave = vi.fn(async () => undefined);
    const secondActivate = vi.fn();
    const secondLeave = vi.fn(async () => undefined);
    const joinRoom = vi
      .fn()
      .mockResolvedValueOnce({ activate: firstActivate, leave: firstLeave })
      .mockResolvedValueOnce({ activate: secondActivate, leave: secondLeave });
    const runtime = createSessionRuntime({
      createDevSession: vi.fn(async () => session),
      joinRoom,
    });

    await runtime.join('해솔');
    await runtime.join('누리');

    expect(firstLeave).toHaveBeenCalledOnce();
    expect(firstActivate).toHaveBeenCalledOnce();
    expect(secondActivate).toHaveBeenCalledOnce();
    expect(secondLeave).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().status).toBe('connected');
  });

  it('does not publish joining after a waiting join is cancelled', async () => {
    const pendingLeave = deferred<void>();
    const snapshots: string[] = [];
    const runtime = createSessionRuntime({
      createDevSession: vi.fn(async () => session),
      joinRoom: vi
        .fn()
        .mockResolvedValueOnce({ leave: () => pendingLeave.promise })
        .mockResolvedValueOnce({ leave: async () => undefined }),
      onSnapshot: ({ status }) => snapshots.push(status),
    });
    await runtime.join('해솔');

    const replacing = runtime.join('누리');
    await runtime.disconnect();
    pendingLeave.resolve();
    await replacing;

    expect(runtime.getSnapshot().status).toBe('idle');
    expect(snapshots.at(-1)).toBe('idle');
  });

  it('does not publish idle when an older disconnect finishes after a new join', async () => {
    const pendingLeave = deferred<void>();
    const runtime = createSessionRuntime({
      createDevSession: vi.fn(async () => session),
      joinRoom: vi
        .fn()
        .mockResolvedValueOnce({ leave: () => pendingLeave.promise })
        .mockResolvedValueOnce({ leave: async () => undefined }),
    });
    await runtime.join('해솔');

    const disconnecting = runtime.disconnect();
    await runtime.join('누리');
    pendingLeave.resolve();
    await disconnecting;

    expect(runtime.getSnapshot().status).toBe('connected');
  });

  it('leaves the room and reports an error when activation fails', async () => {
    const leave = vi.fn(async () => undefined);
    const runtime = createSessionRuntime({
      createDevSession: vi.fn(async () => session),
      joinRoom: vi.fn(async () => ({
        activate: () => {
          throw new Error('initial state unavailable');
        },
        leave,
      })),
    });

    await runtime.join('해솔');

    expect(leave).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot()).toEqual({ status: 'error', error: 'initial state unavailable' });
  });
});
