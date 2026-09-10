// Local unit coverage only: no browser, device, token signing or Cloud transport is used.
import { expect, it, vi } from 'vitest';
import type {
  InteractionContext,
  InteractionDeps,
  MediaBindings,
  MediaGrant,
} from '../../apps/web/src/features/input/InteractionRuntime';
import {
  createDeploymentInteractionFactory,
  type DeploymentMediaProbe,
  type DeploymentProbeSnapshot,
} from '../cloud/DeploymentInteraction';

function fixture() {
  const grant: MediaGrant = {
    matchId: 'match',
    mediaInstanceId: 'media',
    receiverGeneration: 1,
    mediaIdentity: 'identity',
    roomName: 'room',
    url: 'wss://local.invalid',
    token: 'synthetic-local-unit-only',
    expiresAt: 1900000000,
  };
  let snapshot: DeploymentProbeSnapshot = {
    connected: false,
    localTracks: [],
    allowedReceived: { video: 0, audio: 0 },
    forbiddenReceived: 0,
  };
  const probe = {
    connect: vi.fn(async () => {
      snapshot = { ...snapshot, connected: true };
    }),
    publish: vi.fn(async () => {
      snapshot = { ...snapshot, localTracks: [{ sid: 'actual-local-face', kind: 'video' }] };
    }),
    applyBindings: vi.fn<DeploymentMediaProbe['applyBindings']>(async () => {}),
    applyAudioPolicy: vi.fn<DeploymentMediaProbe['applyAudioPolicy']>(async () => {}),
    snapshot: vi.fn(async () => snapshot),
    close: vi.fn(async () => {
      snapshot = { ...snapshot, connected: false, localTracks: [] };
    }),
  } satisfies DeploymentMediaProbe;
  const callbacks: InteractionDeps = {
    sendCommand: vi.fn(() => 'request'),
    requestMediaGrant: vi.fn(async () => grant),
    reportMediaStatus: vi.fn(async () => {}),
    requestBindingsRefresh: vi.fn(),
    onDeviceStatus: vi.fn(),
    onFaceTrack: vi.fn(),
    onMediaStatus: vi.fn(),
    onSensors: vi.fn(),
    onInteractionState: vi.fn(),
    onLocalPreview: vi.fn(),
  };
  const failures = vi.fn();
  const runtime = createDeploymentInteractionFactory(probe, { onFailure: failures })(callbacks);
  runtime.setContext({ selfPlayerId: 'self' } as InteractionContext);
  const bindings: MediaBindings = {
    matchId: grant.matchId,
    mediaInstanceId: grant.mediaInstanceId,
    receiverGeneration: grant.receiverGeneration,
    bindingRevision: 1,
    participants: [
      {
        playerId: 'self',
        publisherGeneration: 1,
        mediaIdentity: 'identity',
        participantSid: 'actual-participant',
        faceTrackSid: 'actual-local-face',
      },
    ],
  };
  return { runtime, probe, callbacks, failures, grant, bindings };
}

it('confirms a publication only after browser publish and the server-owned self SID match', async () => {
  const f = fixture();
  await f.runtime.connectMedia(f.grant);
  await f.runtime.connectMedia(f.grant);
  expect(f.probe.connect).toHaveBeenCalledOnce();
  f.runtime.applyMediaBindings(f.bindings);
  expect(f.runtime.getPublications()).toEqual([]);
  await f.runtime.publishMedia();
  expect(f.runtime.getPublications()).toMatchObject([
    { source: 'processed-face', trackSid: 'actual-local-face', serverConfirmed: true },
  ]);
  f.runtime.applyMediaBindings({ ...f.bindings, bindingRevision: 2, participants: [] });
  await vi.waitFor(() => expect(f.runtime.getPublications()).toEqual([]));
  const calls = f.probe.applyBindings.mock.calls.length;
  f.runtime.applyMediaBindings({ ...f.bindings, receiverGeneration: 0, bindingRevision: 100 });
  expect(f.probe.applyBindings).toHaveBeenCalledTimes(calls);
  await f.runtime.dispose();
});

it('does not report connected when the browser snapshot has not established a connection', async () => {
  const f = fixture();
  f.probe.connect.mockResolvedValueOnce(undefined);
  await expect(f.runtime.connectMedia(f.grant)).rejects.toThrow('PROBE_CONNECT_FAILED');
  expect(f.callbacks.onMediaStatus).not.toHaveBeenCalledWith(
    expect.objectContaining({ state: 'connected' }),
  );
  expect(f.failures).toHaveBeenCalledWith('PROBE_CONNECT_FAILED');
  await f.runtime.dispose();
});

it('waits for in-flight publication before browser close and never confirms a late publication', async () => {
  const f = fixture();
  await f.runtime.connectMedia(f.grant);
  let finish!: () => void;
  const publish = f.probe.publish.getMockImplementation()!;
  f.probe.publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => {
          void publish().then(resolve);
        };
      }),
  );
  const publishing = f.runtime.publishMedia();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const retiring = f.runtime.retireMediaGeneration('reconnect');
  expect(f.runtime.getGenerationState()).toBe('terminal');
  expect(f.probe.close).not.toHaveBeenCalled();
  finish();
  await publishing;
  await retiring;
  expect(f.probe.close).toHaveBeenCalledOnce();
  expect(f.runtime.getPublications()).toEqual([]);
  expect(f.runtime.getGenerationState()).toBe('closed');
  expect(f.callbacks.onMediaStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: 'closed' }),
  );
  await f.runtime.dispose();
});

it('keeps retirement unconfirmed when browser close leaves a local track alive', async () => {
  const f = fixture();
  await f.runtime.connectMedia(f.grant);
  await f.runtime.publishMedia();
  f.probe.close.mockResolvedValueOnce(undefined);
  await expect(f.runtime.retireMediaGeneration()).rejects.toThrow('PROBE_RETIREMENT_UNCONFIRMED');
  expect(f.runtime.getGenerationState()).toBe('terminal');
  expect(f.callbacks.onMediaStatus).not.toHaveBeenCalledWith(
    expect.objectContaining({ state: 'closed' }),
  );
  expect(() => f.runtime.beginMediaGeneration()).toThrow('GENERATION_NOT_CLOSED');
  await f.runtime.dispose().catch(() => {});
});
