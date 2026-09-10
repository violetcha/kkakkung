/** Test-only synthetic D facade. C bindProductRoom, B transport and E remain real.
 * No DOM, camera, inference, SDK or Cloud success is claimed by this fixture.
 */
import type {
  InteractionDeps,
  InteractionRuntime,
  MediaGrant,
} from '../features/input/InteractionRuntime';
import { INITIAL_DEVICES } from '../features/game/flow/device-readiness';

export interface SyntheticMediaControl {
  /** Test-only SDK terminal disconnect. At most one signal per fixture lifetime. */
  failOnce(): boolean;
}

export function createSyntheticInteractionFactory(hooks: {
  publish(grant: MediaGrant): Promise<void> | void;
  close?(grant: MediaGrant): Promise<void> | void;
  control?(control: SyntheticMediaControl): void;
}) {
  return (deps: InteractionDeps): InteractionRuntime => {
    let grant: MediaGrant | null = null;
    let state: 'live' | 'terminal' | 'closed' = 'live';
    let closing: Promise<void> | null = null;
    let failed = false;
    let publications: ReturnType<InteractionRuntime['getPublications']> = [];
    const devices = {
      ...INITIAL_DEVICES,
      camera: 'ready' as const,
      vision: 'ready' as const,
      calibration: 'ready' as const,
      audioPlayback: 'ready' as const,
    };
    const retire = () => {
      if (closing) return closing;
      state = 'terminal';
      closing ??= (async () => {
        if (grant) await hooks.close?.(grant);
        publications = [];
        state = 'closed';
      })();
      return closing;
    };
    hooks.control?.({
      failOnce() {
        if (failed || !grant || state !== 'live') return false;
        failed = true;
        deps.onMediaStatus({
          matchId: grant.matchId,
          mediaInstanceId: grant.mediaInstanceId,
          receiverGeneration: grant.receiverGeneration,
          state: 'closed',
          code: 'DISCONNECTED',
        });
        return true;
      },
    });
    return {
      setContext: () => {},
      startDevices: async () => {
        deps.onDeviceStatus(devices);
        return devices;
      },
      calibrate: async () => {
        deps.onDeviceStatus(devices);
        return devices;
      },
      connectMedia: async (next) => {
        grant = next;
        deps.onMediaStatus({
          matchId: next.matchId,
          mediaInstanceId: next.mediaInstanceId,
          receiverGeneration: next.receiverGeneration,
          state: 'connected',
          code: null,
        });
      },
      publishMedia: async () => {
        if (!grant || state !== 'live') return null;
        await hooks.publish(grant);
        return null;
      },
      applyMediaBindings: (bindings) => {
        const self = bindings.participants.find((p) => p.mediaIdentity === grant?.mediaIdentity);
        if (grant && self?.faceTrackSid)
          publications = [
            {
              source: 'processed-face',
              trackSid: self.faceTrackSid,
              scope: bindings,
              serverConfirmed: true,
            },
          ];
      },
      applyAudioPolicy: () => {},
      setQualityPreset: () => {},
      setAudioOutputLock: () => {},
      retireMediaGeneration: retire,
      beginMediaGeneration: () => {
        state = 'live';
        closing = null;
      },
      getGenerationState: () => state,
      getPublications: () => publications,
      addRemoteTrack: () => {},
      removeRemoteTrack: () => {},
      endParticipation: retire,
      dispose: retire,
    };
  };
}
