/** F-owned deployment harness bridge. Only the injected browser probe performs media IO.
 * Device/vision readiness and input controls are synthetic; this is not D device acceptance.
 * Grants stay in memory and error messages contain fixed codes only.
 */
import type {
  AudioPolicy,
  InteractionContext,
  InteractionDeps,
  InteractionRuntime,
  MediaBindings,
  MediaGrant,
  MediaScope,
} from '../../apps/web/src/features/input/InteractionRuntime';
import { INITIAL_DEVICES } from '../../apps/web/src/features/game/flow/device-readiness';
import {
  DEFAULT_AUDIO_PREFERENCES,
  normalizeAudioPreferences,
} from '../../apps/web/src/features/media/audio-preferences';

export interface DeploymentProbeSnapshot {
  connected: boolean;
  localTracks: readonly { sid: string; kind: 'video' | 'audio' }[];
  allowedReceived: Readonly<{ video: number; audio: number }>;
  forbiddenReceived: number;
  forbiddenByKind?: Readonly<{ video: number; audio: number }>;
  forbiddenByReason?: Readonly<{ binding: number; audioPolicy: number }>;
}

export interface DeploymentMediaProbe {
  connect(grant: MediaGrant): Promise<void>;
  publish(): Promise<void>;
  applyBindings(bindings: MediaBindings): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): Promise<void>;
  snapshot(): Promise<DeploymentProbeSnapshot>;
  /** Resolve only after SDK IO, publications, received tracks and playback resources close. */
  close(): Promise<void>;
}

export type DeploymentInteractionFailure =
  | 'PROBE_CONNECT_FAILED'
  | 'PROBE_PUBLISH_FAILED'
  | 'PROBE_BINDINGS_FAILED'
  | 'PROBE_AUDIO_FAILED'
  | 'PROBE_RETIREMENT_UNCONFIRMED';

const sameScope = (left: MediaScope, right: MediaScope) =>
  left.matchId === right.matchId &&
  left.mediaInstanceId === right.mediaInstanceId &&
  left.receiverGeneration === right.receiverGeneration;
const scopeOf = (grant: MediaGrant): MediaScope => ({
  matchId: grant.matchId,
  mediaInstanceId: grant.mediaInstanceId,
  receiverGeneration: grant.receiverGeneration,
});

export function createDeploymentInteractionFactory(
  probe: DeploymentMediaProbe,
  options: { onFailure?(code: DeploymentInteractionFailure): void } = {},
): (deps: InteractionDeps) => InteractionRuntime {
  return (deps) => {
    let grant: MediaGrant | null = null;
    let context: InteractionContext | null = null;
    let state: 'live' | 'terminal' | 'closed' = 'live';
    let disposed = false;
    let audioPreferences = DEFAULT_AUDIO_PREFERENCES;
    let published = false;
    let bindings: MediaBindings | null = null;
    let publications: ReturnType<InteractionRuntime['getPublications']> = [];
    let tail: Promise<unknown> = Promise.resolve();
    let closing: Promise<void> | null = null;
    let connecting: Promise<void> | null = null;
    const devices = {
      ...INITIAL_DEVICES,
      camera: 'ready' as const,
      vision: 'ready' as const,
      calibration: 'ready' as const,
      audioPlayback: 'ready' as const,
    };
    const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
      const result = tail.then(work);
      tail = result.catch(() => {});
      return result;
    };
    const live = (scope: MediaScope) =>
      !disposed && state === 'live' && grant !== null && sameScope(grant, scope);
    const fail = (code: DeploymentInteractionFailure, scope: MediaScope | null) => {
      options.onFailure?.(code);
      if (scope && live(scope)) deps.onMediaStatus({ ...scope, state: 'failed', code });
      return new Error(code);
    };
    const confirm = (snapshot: DeploymentProbeSnapshot) => {
      publications = [];
      if (!grant || !bindings || !published || !live(grant) || !snapshot.connected) return;
      const self = bindings.participants.find(
        (participant) =>
          participant.playerId === context?.selfPlayerId &&
          participant.mediaIdentity === grant?.mediaIdentity &&
          participant.publisherGeneration === grant?.receiverGeneration,
      );
      const localFace = snapshot.localTracks.filter((track) => track.kind === 'video');
      if (localFace.length !== 1 || !self?.faceTrackSid || self.faceTrackSid !== localFace[0]!.sid)
        return;
      publications = [
        {
          source: 'processed-face',
          trackSid: self.faceTrackSid,
          scope: scopeOf(grant),
          serverConfirmed: true,
        },
      ];
    };
    const retire = () => {
      if (closing) return closing;
      state = 'terminal';
      publications = [];
      const scope = grant ? scopeOf(grant) : null;
      closing = enqueue(async () => {
        try {
          // Accepted connect/publish/binding IO finishes before the closing browser call.
          await probe.close();
          const snapshot = await probe.snapshot();
          if (snapshot.connected || snapshot.localTracks.length !== 0)
            throw new Error('NOT_CLOSED');
          published = false;
          bindings = null;
          state = 'closed';
          if (scope && !disposed)
            deps.onMediaStatus({ ...scope, state: 'closed', code: 'RETIRED' });
        } catch {
          throw fail('PROBE_RETIREMENT_UNCONFIRMED', scope);
        }
      });
      return closing;
    };
    return {
      setContext(next) {
        context = next;
      },
      async startDevices() {
        if (!disposed) deps.onDeviceStatus(devices);
        return devices;
      },
      async setMicrophone() {
        // This probe publishes its fixed synthetic tracks; it cannot certify device toggles.
        throw new Error('PROBE_MICROPHONE_CONTROL_UNSUPPORTED');
      },
      async calibrate() {
        if (!disposed) deps.onDeviceStatus(devices);
        return devices;
      },
      connectMedia(next) {
        if (disposed || state !== 'live') return Promise.reject(new Error('GENERATION_CLOSED'));
        if (grant && !sameScope(grant, next))
          return Promise.reject(new Error('PREVIOUS_GENERATION_NOT_CLOSED'));
        if (connecting) return connecting;
        grant = { ...next };
        const scope = scopeOf(next);
        connecting = enqueue(async () => {
          if (!live(scope)) return;
          try {
            await probe.connect(next);
            const snapshot = await probe.snapshot();
            if (!snapshot.connected) throw new Error('NOT_CONNECTED');
            if (live(scope)) deps.onMediaStatus({ ...scope, state: 'connected', code: null });
          } catch {
            throw fail('PROBE_CONNECT_FAILED', scope);
          }
        });
        return connecting;
      },
      publishMedia() {
        const scope = grant ? scopeOf(grant) : null;
        return enqueue(async () => {
          if (!scope || !live(scope)) return null;
          try {
            if (!published) await probe.publish();
            const snapshot = await probe.snapshot();
            const faces = snapshot.localTracks.filter((track) => track.kind === 'video');
            if (!snapshot.connected || faces.length !== 1) throw new Error('NOT_PUBLISHED');
            if (!live(scope)) return null;
            published = true;
            confirm(snapshot);
            return faces[0]!.sid;
          } catch {
            throw fail('PROBE_PUBLISH_FAILED', scope);
          }
        });
      },
      applyMediaBindings(next) {
        if (!live(next) || (bindings && next.bindingRevision <= bindings.bindingRevision)) return;
        bindings = structuredClone(next);
        void enqueue(async () => {
          if (!live(next)) return;
          await probe.applyBindings(next);
          confirm(await probe.snapshot());
        }).catch(() => {
          fail('PROBE_BINDINGS_FAILED', next);
        });
      },
      applyAudioPolicy(policy) {
        if (!live(policy)) return;
        void enqueue(async () => {
          if (live(policy)) await probe.applyAudioPolicy(policy);
        }).catch(() => {
          fail('PROBE_AUDIO_FAILED', policy);
        });
      },
      retireMediaGeneration: retire,
      beginMediaGeneration() {
        if (disposed || state === 'terminal') throw new Error('GENERATION_NOT_CLOSED');
        if (state === 'live') return;
        grant = null;
        bindings = null;
        publications = [];
        published = false;
        closing = null;
        connecting = null;
        state = 'live';
      },
      getGenerationState: () => state,
      getPublications: () => publications,
      endParticipation: retire,
      async dispose() {
        disposed = true;
        await retire();
        grant = null;
      },
      // The Cloud harness supplies synthetic input and checks media policy at the probe.
      setQualityPreset: () => {},
      setAudioOutputLock: () => {},
      // This harness does not claim device diagnostics or local audio graph acceptance.
      setAudioPreferences: (value) => {
        audioPreferences = normalizeAudioPreferences(value);
      },
      getLocalAudioStatus: () => ({
        preferences: audioPreferences,
        microphoneLevel: null,
        testTonePlaying: false,
      }),
      playTestTone: async () => 'unavailable',
      addRemoteTrack: () => {},
      removeRemoteTrack: () => {},
    };
  };
}
