export type SessionStatus = 'idle' | 'joining' | 'connected' | 'error';

export interface RoomLifetime {
  activate?(): void;
  leave(): Promise<void> | void;
}

export interface SessionRuntimeSnapshot {
  status: SessionStatus;
  error?: string;
}

export interface SessionRuntime {
  join(nickname: string): Promise<RoomLifetime | undefined>;
  disconnect(): Promise<void>;
  getSnapshot(): SessionRuntimeSnapshot;
}

export function createSessionRuntime(dependencies: {
  createDevSession(nickname: string): Promise<{ token: string; expiresAt: number }>;
  joinRoom(token: string): Promise<RoomLifetime>;
  onSnapshot?(snapshot: SessionRuntimeSnapshot): void;
}): SessionRuntime {
  let generation = 0;
  let current: RoomLifetime | undefined;
  let snapshot: SessionRuntimeSnapshot = { status: 'idle' };
  const update = (next: SessionRuntimeSnapshot) => {
    snapshot = next;
    dependencies.onSnapshot?.(next);
  };
  const leaveCurrent = async () => {
    const room = current;
    current = undefined;
    await room?.leave();
  };

  return {
    async join(nickname) {
      const request = ++generation;
      await leaveCurrent();
      if (request !== generation) return undefined;
      update({ status: 'joining' });
      try {
        const session = await dependencies.createDevSession(nickname);
        if (request !== generation) return undefined;
        const room = await dependencies.joinRoom(session.token);
        if (request !== generation) {
          await room.leave();
          return undefined;
        }
        current = room;
        room.activate?.();
        update({ status: 'connected' });
        return room;
      } catch (error) {
        if (request === generation) {
          await leaveCurrent().catch(() => undefined);
          update({
            status: 'error',
            error: error instanceof Error ? error.message : '연결할 수 없습니다.',
          });
        }
        return undefined;
      }
    },
    async disconnect() {
      const request = ++generation;
      await leaveCurrent();
      if (request === generation) update({ status: 'idle' });
    },
    getSnapshot: () => snapshot,
  };
}

/** Locks synchronously before either asynchronous cleanup starts. Room stays for personal results. */
export function createParticipationLifetime(deps: {
  lock(): void;
  clear(): void;
  end(): Promise<void>;
  leave(): Promise<void>;
}) {
  let ended: Promise<void> | null = null;
  let left: Promise<void> | null = null;
  const end = () => {
    if (!ended) {
      deps.lock();
      deps.clear();
      ended = Promise.resolve().then(deps.end);
    }
    return ended;
  };
  return {
    end,
    leave() {
      if (!left)
        left = end().then(
          () => deps.leave(),
          async (error: unknown) => {
            await deps.leave();
            throw error;
          },
        );
      return left;
    },
  };
}
