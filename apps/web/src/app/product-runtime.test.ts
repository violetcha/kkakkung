import { expect, it, vi } from 'vitest';
import type { PublicMatchState } from '@kkakkung/protocol/game-schema';
import type {
  InteractionContext,
  InteractionDeps,
  InteractionRuntime,
} from '../features/input/InteractionRuntime';
import { bindProductRoom, type ProductRoomPort } from './product-runtime';
import { roundFixture, viewFixture } from '../features/room/product-fixture';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
function fixture() {
  let now = 0;
  let sequence = 0;
  const messages = new Map<string, (value: unknown) => void>();
  let stateHandler!: (state: PublicMatchState) => void;
  let leaveHandler!: () => void;
  const context = vi.fn<(context: InteractionContext) => void>();
  const end = vi.fn(async () => {});
  const dispose = vi.fn(async () => {});
  let callbacks!: InteractionDeps;
  const fake: InteractionRuntime = {
    setContext: context,
    endParticipation: end,
    dispose,
    startDevices: vi.fn(async () => INITIAL_DEVICES),
    calibrate: vi.fn(async () => INITIAL_DEVICES),
    connectMedia: vi.fn(async () => {}),
    applyAudioPolicy: vi.fn(),
    applyMediaBindings: vi.fn(),
    setQualityPreset: vi.fn(),
    retireMediaGeneration: vi.fn(async () => {}),
    beginMediaGeneration: vi.fn(),
    getGenerationState: () => 'live',
    publishMedia: vi.fn(async () => null),
    getPublications: () => [],
    addRemoteTrack: vi.fn(),
    removeRemoteTrack: vi.fn(),
    setAudioOutputLock: vi.fn(),
  };
  const send = vi.fn();
  const leave = vi.fn(async () => {});
  const room: ProductRoomPort = {
    state: roundFixture({ phase: 'DEVICE_CHECK' }) as unknown as PublicMatchState,
    send,
    leave,
    onMessage(type, handler) {
      messages.set(type, handler);
      return () => {
        messages.delete(type);
      };
    },
    onStateChange(handler) {
      stateHandler = handler;
      return vi.fn();
    },
    onLeave(handler) {
      leaveHandler = handler;
      return vi.fn();
    },
    onError: () => vi.fn(),
  };
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 }));
  const runtime = bindProductRoom(
    room,
    {
      sessionToken: 'private',
      playerId: 'self',
      roomCode: 'ABCDEF',
      expiresAt: 1900000000000,
      protocolVersion: '0.2.0',
    },
    {
      now: () => now,
      uuid: () => `10000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
      changed: vi.fn(),
      fetcher,
      interactionFactory: (deps) => {
        callbacks = deps;
        return fake;
      },
    },
  );
  return {
    runtime,
    messages,
    send,
    leave,
    end,
    dispose,
    context,
    fake,
    fetcher,
    get callbacks() {
      return callbacks;
    },
    state: (overrides: Parameters<typeof roundFixture>[0]) =>
      stateHandler(roundFixture(overrides) as unknown as PublicMatchState),
    close: () => leaveHandler(),
    time: (value: number) => {
      now = value;
      runtime.poll();
    },
  };
}
it('shares installation pending across D and buttons without optimistic inventory or stale cancel', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  const v = viewFixture();
  if (v.self?.status !== 'ACTIVE') throw Error();
  f.messages.get('private-view')!({
    ...v,
    self: { ...v.self, role: 'tagger', equipment: { sensor: 2, trap: 1 } },
  });
  f.runtime.selectEquipment('trap');
  expect(f.context.mock.lastCall?.[0].selectedEquipment).toBe('trap');
  const first = f.runtime.send({ type: 'INSTALL', payload: { kind: 'trap' } });
  expect(f.callbacks.sendCommand({ type: 'INSTALL', payload: { kind: 'trap' } })).toBe(first);
  expect(f.send.mock.calls.filter(([channel]) => channel === 'command')).toHaveLength(1);
  expect(f.runtime.send({ type: 'INSTALL_CANCEL', payload: { installationId: 'stale' } })).toBe('');
  expect(f.runtime.getSnapshot().view?.self).toMatchObject({ equipment: { sensor: 2, trap: 1 } });
  await f.runtime.leave();
});
it('connects heartbeat ACK on the actual product channel with no media calls in lobby/device check', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) {
    f.time(i * 2000);
    f.messages.get('game-heartbeat')!({
      matchId: 'm',
      serverEpoch: 'e',
      heartbeatSeq: i,
      serverTick: i * 40,
      serverTimeMs: i * 2000,
    });
  }
  expect(f.send.mock.calls.filter((c) => c[0] === 'game-heartbeat-ack')).toHaveLength(5);
  expect(f.runtime.getSnapshot().lost).toBe(false);
  expect(f.fetcher).not.toHaveBeenCalled();
  await f.runtime.leave();
  expect(f.dispose).toHaveBeenCalledOnce();
});
it('locks COUNTDOWN, tab hide and socket close synchronously and cleans up once', async () => {
  const f = fixture();
  f.state({ phase: 'COUNTDOWN', stateVersion: 11 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 11 }));
  expect(f.context.mock.lastCall?.[0].pageActive).toBe(false);
  expect(f.runtime.send({ type: 'TURN', payload: { direction: 'left' } })).toBe('');
  f.state({ stateVersion: 12 });
  f.messages.get('private-view')!(viewFixture({ stateVersion: 12 }));
  f.runtime.setPageActive(false);
  expect(f.context.mock.lastCall?.[0].pageActive).toBe(false);
  f.close();
  f.time(6000);
  await f.runtime.leave();
  expect(f.runtime.getSnapshot().lost).toBe(true);
  expect(f.end).toHaveBeenCalledOnce();
  expect(f.leave).toHaveBeenCalledOnce();
  expect(f.messages.size).toBe(0);
});
it('keeps Room for personal result but removes scene immediately and later leaves independently', async () => {
  const f = fixture();
  f.state({ phase: 'PLAYING' });
  f.messages.get('private-view')!(
    viewFixture({ self: { playerId: 'self', role: 'runner', status: 'ESCAPED' } }),
  );
  await Promise.resolve();
  expect(f.end).toHaveBeenCalledOnce();
  expect(f.leave).not.toHaveBeenCalled();
  expect(f.runtime.getSnapshot().view).toBeNull();
  f.state({ stateVersion: 11, counts: { escaped: 2, captured: 0 }, phase: 'RESULT' });
  expect(f.runtime.getSnapshot().round?.counts.escaped).toBe(2);
  await f.runtime.leave();
  expect(f.leave).toHaveBeenCalledOnce();
  expect(f.end).toHaveBeenCalledOnce();
});
it('recreates a disposed runtime for new match and rejects old view and command events', async () => {
  const f = fixture();
  f.state({ phase: 'RESULT', stateVersion: 11 });
  await Promise.resolve();
  f.state({ matchId: 'new', phase: 'DEVICE_CHECK', stateVersion: 0 });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.runtime.getSnapshot().endedSelf).toBeNull();
  f.messages.get('private-view')!(viewFixture({ stateVersion: 500 }));
  expect(f.runtime.getSnapshot().view).toBeNull();
  await f.runtime.leave();
});
