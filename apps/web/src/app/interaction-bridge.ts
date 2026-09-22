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
import { consentGiven } from '../features/room/consent';

export function createInteractionBridge(
  deps: InteractionDeps,
  factory: (deps: InteractionDeps) => InteractionRuntime = createInteractionRuntime,
  /**
   * S15P21C204-292. 동의 전에는 카메라·마이크를 켜지 않는다.
   *
   * 화면마다 막지 않고 여기서 막는 이유: 장치를 켜는 길은 결국 아래 두 개뿐인데, 그 단추를
   * 그리는 화면은 여럿이고 앞으로 더 늘어난다. 실제로 292 는 장치 점검 화면만 가렸다가
   * `LocalControls` 의 복구·마이크 단추를 놓쳤다. 화면을 하나 더 만들어도 이 검사는 지난다.
   */
  consented: () => boolean = consentGiven,
) {
  let disposed = false;
  let context: InteractionContext | null = null;
  let preview: HTMLVideoElement | null = null;
  let host: HTMLElement | null = null;
  let sensors: SensorSnapshot | null = null;
  let devices: DeviceStatus = INITIAL_DEVICES;
  let interaction: InteractionState = { selectedEquipment: 'sensor', mode: 'motion' };
  let readyRequested = false;
  /**
   * 데모 방(S15P21C204-260)은 미디어를 발급하지 않아 장치 점검이 성립하지 않는다. 운영자가
   * 카메라 없이 방을 돌려 보는 것이 그 방의 용도이므로, 그 방에서만 준비 보고를 연다.
   */
  let demoRoom = false;
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
      // S15P21C204-295. 자리를 옮기는 동안 재생이 멈추면 마지막 프레임이 그대로 굳는다. 그러면
      // 얼굴 인식도 합성 화면도 같은 한 장만 보게 되므로, 붙인 뒤에는 재생을 확인한다.
      if (preview.paused) void preview.play().catch(() => {});
    } else detach();
  };
  const runtime = factory({
    ...deps,
    sendCommand: (command) => (disposed ? '' : deps.sendCommand(command)),
    onDeviceStatus(status) {
      if (disposed) return;
      devices = status;
      if (
        context?.phase === 'DEVICE_CHECK' &&
        readyRequested &&
        !demoRoom &&
        !deviceReady(status)
      ) {
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
      if (!consented() || !canCheckDevices()) return;
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
      if (!consented() || !canCheckDevices()) return;
      await runtime.setMicrophone(microphone);
    },
    setDemoRoom(value: boolean) {
      demoRoom = value;
    },
    ready(value: boolean) {
      if (
        disposed ||
        context?.phase !== 'DEVICE_CHECK' ||
        (value && !demoRoom && !deviceReady(devices))
      )
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
