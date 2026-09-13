import {
  createInteractionRuntime,
  type InteractionDeps,
  type InteractionRuntime,
  type InteractionContext,
  type InteractionState,
  type SensorSnapshot,
  type DeviceStatus,
} from '../features/input/InteractionRuntime';
import { deviceReady, INITIAL_DEVICES } from '../features/game/flow/device-readiness';

export function createInteractionBridge(
  deps: InteractionDeps,
  factory: (deps: InteractionDeps) => InteractionRuntime = createInteractionRuntime,
) {
  let disposed = false;
  let context: InteractionContext | null = null;
  let preview: HTMLVideoElement | null = null;
  let host: HTMLElement | null = null;
  let sensors: SensorSnapshot | null = null;
  let devices: DeviceStatus = INITIAL_DEVICES;
  let interaction: InteractionState = { selectedEquipment: 'sensor', mode: 'motion' };
  let readyRequested = false;
  let deviceRun = 0;
  const canCheckDevices = () =>
    !disposed &&
    context?.status === 'ACTIVE' &&
    ['DEVICE_CHECK', 'TEAM_PRACTICE', 'PLAYING'].includes(context.phase);
  const detach = () => {
    if (preview && preview.parentElement === host) preview.remove();
  };
  const attach = () => {
    const visible =
      !disposed &&
      context?.status === 'ACTIVE' &&
      [
        'DEVICE_CHECK',
        'TEAM_PRACTICE',
        'MAP_FINALIZING',
        'GAME_LOADING',
        'COUNTDOWN',
        'PLAYING',
      ].includes(context.phase);
    if (visible && host && preview) {
      if (preview.parentElement !== host) host.appendChild(preview);
    } else detach();
  };
  const runtime = factory({
    ...deps,
    sendCommand: (command) => (disposed ? '' : deps.sendCommand(command)),
    onDeviceStatus(status) {
      if (disposed) return;
      devices = status;
      if (context?.phase === 'DEVICE_CHECK' && readyRequested && !deviceReady(status)) {
        readyRequested = false;
        deps.sendCommand({ type: 'READY', payload: { ready: false } });
      }
      deps.onDeviceStatus(status);
    },
    onSensors(value) {
      if (disposed) return;
      sensors = value;
      deps.onSensors(value);
    },
    onInteractionState(value) {
      if (
        disposed ||
        (value.mode === interaction.mode &&
          value.selectedEquipment === interaction.selectedEquipment)
      )
        return;
      interaction = value;
      deps.onInteractionState(value);
    },
    onLocalPreview(element) {
      if (disposed) return;
      detach();
      preview = element;
      attach();
      deps.onLocalPreview(element);
    },
    onFaceTrack(event) {
      if (!disposed) deps.onFaceTrack(event);
    },
    onMediaStatus(status) {
      if (!disposed) deps.onMediaStatus(status);
    },
  });
  return {
    runtime,
    setContext(next: InteractionContext) {
      if (disposed) return;
      context = { ...next };
      interaction = { mode: next.mode, selectedEquipment: next.selectedEquipment ?? 'sensor' };
      if (next.phase !== 'DEVICE_CHECK') readyRequested = false;
      runtime.setContext(context);
      attach();
    },
    setPreviewHost(next: HTMLElement | null) {
      if (next === host) return;
      detach();
      host = next;
      attach();
    },
    async startDevices(microphone: boolean) {
      if (!canCheckDevices()) return;
      const run = ++deviceRun;
      const initialContext = context;
      await runtime.startDevices({ microphone });
      if (
        canCheckDevices() &&
        run === deviceRun &&
        context?.matchId === initialContext?.matchId &&
        context?.phase === initialContext?.phase
      )
        await runtime.calibrate();
    },
    async updateMicrophone(microphone: boolean) {
      if (!canCheckDevices()) return;
      await runtime.setMicrophone(microphone);
    },
    ready(value: boolean) {
      if (disposed || context?.phase !== 'DEVICE_CHECK' || (value && !deviceReady(devices)))
        return false;
      readyRequested = value;
      deps.sendCommand({ type: 'READY', payload: { ready: value } });
      return true;
    },
    get sensors() {
      return sensors;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      detach();
      host = null;
      preview = null;
      sensors = null;
      await runtime.dispose();
    },
  };
}
