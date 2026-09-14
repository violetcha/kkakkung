import type { Role } from '@kkakkung/protocol/game-schema';
import { createInteractionBridge } from '../../../app/interaction-bridge';
import { debugFeed } from '../../debug/debug-feed'; // 진단 오버레이(제거 가능)
import {
  createInteractionRuntime,
  type InteractionDeps,
  type InteractionRuntime,
  type DeviceStatus,
  type InteractionState,
  type SensorSnapshot,
  type CommandInput,
  type AudioPreferences,
} from '../../input/InteractionRuntime';
import { isSampleFresh } from '../../vision/sensor-types';
import { INITIAL_DEVICES } from '../flow/device-readiness';
import { createPoseHold } from '../pose/pose-evaluator';
import type { ChallengeKey } from '../pose/key-challenge';
import { createSoloWorld } from './solo-world';

export function createSoloSession(
  options: { now(): number; changed(snapshot: SoloSnapshot): void },
  factory: (deps: InteractionDeps) => InteractionRuntime = createInteractionRuntime,
) {
  const world = createSoloWorld(options.now);
  const poseHold = createPoseHold();
  let devices: DeviceStatus = INITIAL_DEVICES;
  let interaction: InteractionState = { mode: 'keyboard', selectedEquipment: 'sensor' };
  let sensors: SensorSnapshot | null = null;
  let pageActive = true;
  let disposed = false;
  let configuring = false;
  let closePromise: Promise<void> | null = null;
  let bridge: ReturnType<typeof createInteractionBridge> | null = null;
  let deviceAttempt = 0;
  let commandSequence = 0;
  const snapshot = () => ({ ...world.snapshot, devices, interaction });
  const emit = () => {
    if (!disposed) options.changed(snapshot());
  };
  const freshPosture = () => {
    const face = sensors?.face;
    const pose = sensors?.pose;
    return (
      devices.calibration === 'ready' &&
      isSampleFresh(face ?? null, 'face', options.now()) &&
      face?.status === 'valid' &&
      face.data.quality === 'valid' &&
      isSampleFresh(pose ?? null, 'pose', options.now()) &&
      pose?.status === 'valid' &&
      pose.data.quality === 'valid'
    );
  };
  const sync = () => {
    if (disposed || !bridge || configuring) return;
    const state = world.snapshot;
    configuring = true;
    try {
      bridge.setContext({
        matchId: 'solo-local',
        selfPlayerId: state.self.playerId,
        role: state.self.role,
        phase: 'TEAM_PRACTICE',
        status: 'ACTIVE',
        mode: interaction.mode,
        selectedEquipment: interaction.selectedEquipment,
        pageActive,
        exitId: state.exitId,
        challengeId: state.self.challenge?.challengeId,
        poseKind: state.self.challenge?.poseKind,
        installationId: state.self.installation?.installationId,
      });
    } finally {
      configuring = false;
    }
  };
  const command = (value: CommandInput) => {
    if (disposed || !pageActive) return '';
    world.dispatch(
      value,
      !configuring &&
        devices.calibration !== 'running' &&
        (interaction.mode === 'keyboard' || freshPosture()),
    );
    sync();
    emit();
    return 'solo-command-' + ++commandSequence;
  };
  const selectMode = (next: InteractionState['mode']) => {
    if (disposed) return;
    world.clearInput();
    world.clearChallengeProgress();
    poseHold.reset();
    interaction = { ...interaction, mode: next };
    sync();
    emit();
  };
  const unsupportedMedia = () => {
    throw new Error('SOLO_MEDIA_UNAVAILABLE');
  };
  bridge = createInteractionBridge(
    {
      sendCommand: command,
      requestMediaGrant: async () => unsupportedMedia(),
      reportMediaStatus: async () => unsupportedMedia(),
      requestBindingsRefresh: unsupportedMedia,
      onDeviceStatus(value) {
        devices = value;
        emit();
      },
      onSensors(value) {
        sensors = value;
        debugFeed.publishSensors(value); // 진단 오버레이(제거 가능)
        if (interaction.mode === 'motion' && !freshPosture()) world.cancelNeutral();
      },
      onInteractionState(value) {
        if (disposed) return;
        if (interaction.mode !== value.mode) {
          world.clearInput();
          world.clearChallengeProgress();
          poseHold.reset();
        }
        interaction = value;
        sync();
        emit();
      },
      onFaceTrack() {},
      onMediaStatus() {},
      onLocalPreview() {},
      onMotionDebug: (state) => debugFeed.publishMotion(state), // 진단 오버레이(제거 가능)
    },
    factory,
  );
  sync();
  return {
    snapshot,
    poll() {
      if (disposed || !pageActive) return;
      if (interaction.mode === 'motion' && !freshPosture()) world.cancelNeutral();
      world.poll();
      const challenge = world.snapshot.self.challenge;
      if (challenge && interaction.mode === 'motion') {
        const progress = poseHold.observe(
          sensors,
          sensors?.runtimeGeneration ?? -1,
          challenge.poseKind,
          options.now(),
        );
        world.pose(progress.heldMs);
      } else poseHold.reset();
      sync();
      emit();
    },
    command,
    key(key: ChallengeKey, repeat = false) {
      if (disposed || !pageActive || interaction.mode !== 'keyboard') return;
      world.key(key, repeat);
      sync();
      emit();
    },
    lesson(role: Role) {
      if (disposed || !pageActive) return;
      // Clear held keys even when choosing the current role again.
      bridge!.setContext({
        matchId: 'solo-local',
        selfPlayerId: 'solo-self',
        role,
        phase: 'TEAM_PRACTICE',
        status: 'ACTIVE',
        mode: interaction.mode,
        pageActive: false,
      });
      world.lesson(role);
      poseHold.reset();
      sync();
      emit();
    },
    selectKeyboard() {
      deviceAttempt++;
      selectMode('keyboard');
    },
    async startDevices(microphone: boolean) {
      if (disposed || !pageActive) return;
      const attempt = ++deviceAttempt;
      selectMode('keyboard');
      await bridge!.startDevices(microphone);
      if (!disposed && attempt === deviceAttempt && devices.calibration === 'ready')
        selectMode('motion');
    },
    async calibrateMotion() {
      if (disposed || !pageActive) return;
      const attempt = ++deviceAttempt;
      selectMode('keyboard');
      await bridge!.runtime.calibrate();
      if (!disposed && attempt === deviceAttempt && devices.calibration === 'ready')
        selectMode('motion');
    },
    async microphone(enabled: boolean) {
      if (!disposed && pageActive) await bridge!.updateMicrophone(enabled);
    },
    getLocalAudioStatus: () => bridge!.runtime.getLocalAudioStatus(),
    setAudioPreferences(value: AudioPreferences) {
      if (!disposed) bridge!.runtime.setAudioPreferences({ ...value, mutedPlayerIds: [] });
    },
    playTestTone: () => bridge!.runtime.playTestTone(),
    setPreviewHost(element: HTMLElement | null) {
      if (!disposed) bridge!.setPreviewHost(element);
    },
    setPageActive(value: boolean) {
      if (disposed || value === pageActive) return;
      pageActive = value;
      world.setEnabled(value);
      poseHold.reset();
      sync();
      emit();
    },
    dispose() {
      if (closePromise) return closePromise;
      disposed = true;
      pageActive = false;
      deviceAttempt++;
      sensors = null;
      world.setEnabled(false);
      poseHold.reset();
      closePromise = bridge!.dispose();
      return closePromise;
    },
  };
}
export type SoloSnapshot = ReturnType<typeof createSoloWorld>['snapshot'] & {
  devices: DeviceStatus;
  interaction: InteractionState;
};
