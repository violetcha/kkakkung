import { expect, it, vi } from 'vitest';
import { createSoloSession } from './solo-session';
import {
  createInteractionRuntime,
  type InteractionRuntimeOptions,
} from '../../input/InteractionRuntime';

function setup(options: InteractionRuntimeOptions = {}) {
  let now = 0;
  const listeners = new Map<string, (event: KeyboardEvent) => void>();
  const loadLiveKit = vi.fn(async () => {
    throw new Error('unexpected LiveKit connection');
  });
  const createWorker = vi.fn(() => {
    throw new Error('unexpected Worker');
  });
  const timer = new Map<number, () => void>();
  let nextTimer = 0;
  const session = createSoloSession({ now: () => now, changed: vi.fn() }, (deps) =>
    createInteractionRuntime(deps, {
      loadLiveKit,
      keyboardTarget: {
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: (name) => {
          listeners.delete(name);
        },
      },
      vision: {
        now: () => now,
        createWorker,
        createFrameSource: vi.fn(),
        setTimer: (callback) => {
          const id = ++nextTimer;
          timer.set(id, callback);
          return id;
        },
        clearTimer: (id) => {
          timer.delete(id);
        },
      },
      ...options,
    }),
  );
  return {
    session,
    listeners,
    loadLiveKit,
    createWorker,
    timer,
    advance(ms: number) {
      now += ms;
      session.poll();
    },
    key(name: 'keydown' | 'keyup', code: string, repeat = false) {
      listeners.get(name)?.({ code, repeat, target: null, preventDefault() {} } as KeyboardEvent);
    },
  };
}

it('uses real runtime keyboard handlers and cleans their timers without loading or joining LiveKit', async () => {
  const h = setup();
  expect(h.listeners.size).toBe(2);
  h.key('keydown', 'KeyW');
  expect(h.session.snapshot().self.action?.kind).toBe('move');
  h.advance(200);
  h.key('keyup', 'KeyW');
  h.advance(500);
  expect(h.session.snapshot().completed).toContain('forward');
  expect(h.session.snapshot().completed).not.toContain('neutral');
  h.advance(250);
  expect(h.session.snapshot().completed).toContain('neutral');
  h.key('keydown', 'KeyA');
  h.key('keydown', 'KeyA', true);
  h.key('keyup', 'KeyA');
  h.advance(300);
  expect(h.session.snapshot().self.dir).toBe(3);
  const closing = h.session.dispose();
  expect(h.session.dispose()).toBe(closing);
  await closing;
  expect(h.listeners.size).toBe(0);
  expect(h.timer.size).toBe(0);
  expect(h.loadLiveKit).not.toHaveBeenCalled();
  expect(h.createWorker).not.toHaveBeenCalled();
});

it('stops a late camera permission result after cancellation before vision can start', async () => {
  let resolve!: (stream: MediaStream) => void;
  const stopped = vi.fn();
  const track = { kind: 'video', readyState: 'live', stop: stopped };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
  const h = setup({
    environment: {
      getUserMedia: () =>
        new Promise<MediaStream>((done) => {
          resolve = done;
        }),
      createPreviewElement: vi.fn(),
    },
  });
  const starting = h.session.startDevices(false);
  await h.session.dispose();
  resolve(stream);
  await starting;
  expect(stopped).toHaveBeenCalledOnce();
  expect(h.listeners.size).toBe(0);
  expect(h.createWorker).not.toHaveBeenCalled();
  expect(h.loadLiveKit).not.toHaveBeenCalled();
});

it('clears held actions on focus and role changes and starts a new session with no completion or device state', async () => {
  const h = setup();
  h.key('keydown', 'KeyW');
  h.session.setPageActive(false);
  h.advance(1000);
  expect(h.session.snapshot().self.cell).toEqual({ x: 2, y: 3 });
  expect(h.session.snapshot().completed).toEqual([]);
  h.session.setPageActive(true);
  h.session.lesson('tagger');
  h.advance(1000);
  expect(h.session.snapshot().self.cell).toEqual({ x: 1, y: 3 });
  h.key('keydown', 'KeyF');
  h.advance(500);
  expect(h.session.snapshot().completed).toContain('tagger');
  await h.session.dispose();
  const fresh = setup();
  expect(fresh.session.snapshot().completed).toEqual([]);
  expect(fresh.session.snapshot().devices.camera).toBe('idle');
  expect(fresh.session.snapshot().self.role).toBe('runner');
  await fresh.session.dispose();
});
