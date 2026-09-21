import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createSoloSession } from './solo-session';
import { clearConsentedDevice, useConsentedDevice } from '../../room/consent-fixture';
import {
  createInteractionRuntime,
  type InteractionRuntimeOptions,
} from '../../input/InteractionRuntime';
import { INPUT_TUNING } from '../../input/input-tuning';

// 개인 체험도 같은 다리를 쓴다. 동의 없이는 장치에 닿지 않으므로(S15P21C204-292) 이미 동의한
// 기기에서 시작한다.
beforeAll(() => useConsentedDevice());
afterAll(() => clearConsentedDevice());

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
    /** 잡힌 런타임 타이머를 모두 깨운다. 유지 시간이 덜 찬 타이머는 스스로 다시 잔다. */
    fire() {
      for (const [id, callback] of [...timer.entries()]) {
        timer.delete(id);
        callback();
      }
    },
    key(name: 'keydown' | 'keyup', code: string, repeat = false) {
      listeners.get(name)?.({ code, repeat, target: null, preventDefault() {} } as KeyboardEvent);
    },
  };
}

it('uses real runtime keyboard handlers and cleans their timers without loading or joining LiveKit', async () => {
  const h = setup();
  expect(h.listeners.size).toBe(2);
  // 개인 체험도 제품과 같은 키보드 규칙이다: 모션과 같은 유지 시간을 채워야 움직인다(265).
  h.key('keydown', 'KeyW');
  expect(h.session.snapshot().self.action).toBeNull();
  h.advance(INPUT_TUNING.forwardHoldMs);
  h.fire();
  expect(h.session.snapshot().self.action?.kind).toBe('move');
  h.advance(200);
  h.key('keyup', 'KeyW');
  h.advance(500);
  expect(h.session.snapshot().completed).toContain('forward');
  expect(h.session.snapshot().completed).not.toContain('neutral');
  h.advance(400);
  expect(h.session.snapshot().completed).toContain('neutral');
  h.key('keydown', 'KeyA');
  h.key('keydown', 'KeyA', true);
  h.advance(INPUT_TUNING.turnHoldMs);
  h.fire();
  h.key('keyup', 'KeyA');
  h.advance(450);
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
