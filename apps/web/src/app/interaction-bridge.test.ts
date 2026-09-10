import { expect, it, vi } from 'vitest';
import { createInteractionBridge } from './interaction-bridge';
import type {
  InteractionContext,
  InteractionDeps,
  InteractionRuntime,
} from '../features/input/InteractionRuntime';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';
const context: InteractionContext = {
  matchId: 'm',
  selfPlayerId: 's',
  role: null,
  phase: 'DEVICE_CHECK',
  status: 'ACTIVE',
  mode: 'motion',
  pageActive: true,
};
it('registers callbacks once, keeps sensor updates out of UI and ignores late disposed callbacks', async () => {
  let callbacks!: InteractionDeps;
  const runtime = {
    setContext: vi.fn(),
    dispose: vi.fn(async () => {}),
    startDevices: vi.fn(async () => INITIAL_DEVICES),
    calibrate: vi.fn(async () => INITIAL_DEVICES),
  } as unknown as InteractionRuntime;
  const changed = vi.fn();
  const sendCommand = vi.fn(() => 'id');
  const bridge = createInteractionBridge(
    {
      sendCommand,
      requestMediaGrant: vi.fn(),
      reportMediaStatus: vi.fn(),
      requestBindingsRefresh: vi.fn(),
      onDeviceStatus: changed,
      onFaceTrack: vi.fn(),
      onMediaStatus: vi.fn(),
      onSensors: vi.fn(),
      onInteractionState: vi.fn(),
      onLocalPreview: vi.fn(),
    },
    (deps) => {
      callbacks = deps;
      return runtime;
    },
  );
  bridge.setContext(context);
  expect(bridge.ready(true)).toBe(false);
  callbacks.onDeviceStatus({
    ...INITIAL_DEVICES,
    camera: 'ready',
    vision: 'ready',
    calibration: 'ready',
    audioPlayback: 'ready',
  });
  expect(bridge.ready(true)).toBe(true);
  callbacks.onDeviceStatus(INITIAL_DEVICES);
  expect(sendCommand.mock.lastCall?.[0]).toEqual({ type: 'READY', payload: { ready: false } });
  bridge.setContext({ ...context, challengeId: 'challenge' });
  bridge.setContext(context);
  expect(runtime.setContext).toHaveBeenLastCalledWith(context);
  await bridge.dispose();
  await bridge.dispose();
  callbacks.onDeviceStatus(INITIAL_DEVICES);
  expect(runtime.dispose).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledTimes(2);
});
it('reattaches a D-owned preview only in device check and removes attachment without touching media', async () => {
  let callbacks!: InteractionDeps;
  const runtime = {
    setContext: vi.fn(),
    dispose: vi.fn(async () => {}),
  } as unknown as InteractionRuntime;
  const deps: InteractionDeps = {
    sendCommand: vi.fn(),
    requestMediaGrant: vi.fn(),
    reportMediaStatus: vi.fn(),
    requestBindingsRefresh: vi.fn(),
    onDeviceStatus: vi.fn(),
    onFaceTrack: vi.fn(),
    onMediaStatus: vi.fn(),
    onSensors: vi.fn(),
    onInteractionState: vi.fn(),
    onLocalPreview: vi.fn(),
  };
  const bridge = createInteractionBridge(deps, (d) => {
    callbacks = d;
    return runtime;
  });
  const element = {
    parentElement: null as unknown,
    remove: vi.fn(() => {
      element.parentElement = null;
    }),
  };
  const host = {
    appendChild: vi.fn(() => {
      element.parentElement = host;
    }),
  };
  callbacks.onLocalPreview(element as unknown as HTMLVideoElement);
  bridge.setPreviewHost(host as unknown as HTMLElement);
  expect(host.appendChild).not.toHaveBeenCalled();
  bridge.setContext(context);
  expect(host.appendChild).toHaveBeenCalledOnce();
  bridge.setPreviewHost(null);
  bridge.setPreviewHost(host as unknown as HTMLElement);
  expect(host.appendChild).toHaveBeenCalledTimes(2);
  bridge.setContext({ ...context, phase: 'PLAYING' });
  expect(element.parentElement).toBeNull();
  await bridge.dispose();
  callbacks.onLocalPreview(element as unknown as HTMLVideoElement);
  expect(host.appendChild).toHaveBeenCalledTimes(2);
});
