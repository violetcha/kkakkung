import { TrackSource, TrackType } from 'livekit-server-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  TrackRegistry,
  type RemoteParticipant,
  type TrackOwner,
} from '../../src/media/TrackRegistry.js';

const owner: TrackOwner = {
  matchId: 'm',
  mediaInstanceId: 'i',
  mediaRoomName: 'room',
  playerId: 'p',
  mediaIdentity: 'identity',
  publisherGeneration: 1,
};
const face = { sid: 'FACE', source: TrackSource.CAMERA, type: TrackType.VIDEO };
const audio = { sid: 'AUDIO', source: TrackSource.MICROPHONE, type: TrackType.AUDIO };
const participant = (): RemoteParticipant => ({
  sid: 'PA_1',
  identity: 'identity',
  tracks: [face, audio],
});
function setup() {
  let now = 0;
  let remote: RemoteParticipant | null = participant();
  const changed = vi.fn();
  const unauthorized = vi.fn();
  const query = vi.fn(async () => remote);
  const registry = new TrackRegistry({
    now: () => now,
    getParticipant: query,
    onChanged: changed,
    onUnauthorized: unauthorized,
  });
  registry.register(owner);
  return {
    registry,
    query,
    changed,
    unauthorized,
    time: (value: number) => {
      now = value;
    },
    remote: (value: RemoteParticipant | null) => {
      remote = value;
    },
  };
}

describe('verified current track registry', () => {
  it('does not authorize reported SIDs until current publication query verifies them', async () => {
    const s = setup();
    expect(s.registry.validateTrack(owner, 'AUDIO')).toBe(false);
    expect(s.registry.markEvent({ roomName: 'room', identity: 'identity' })).toBe(true);
    await s.registry.reconcileDue();
    expect(s.registry.bindingFor(owner)).toEqual({
      playerId: 'p',
      publisherGeneration: 1,
      mediaIdentity: 'identity',
      participantSid: 'PA_1',
      faceTrackSid: 'FACE',
      audioTrackSid: 'AUDIO',
    });
    expect(s.registry.validateTrack(owner, 'AUDIO')).toBe(true);
    expect(s.registry.validateTrack({ ...owner, mediaInstanceId: 'other' }, 'AUDIO')).toBe(false);
  });
  it('merges dirty events, limits each participant to 5s and checks active stale state after 30s', async () => {
    const s = setup();
    await s.registry.reconcileDue();
    s.registry.markDirty(owner);
    s.registry.markDirty(owner);
    s.time(4999);
    await s.registry.reconcileDue();
    expect(s.query).toHaveBeenCalledTimes(1);
    s.time(5000);
    await s.registry.reconcileDue();
    expect(s.query).toHaveBeenCalledTimes(2);
    s.time(10_000);
    await s.registry.reconcileDue();
    expect(s.query).toHaveBeenCalledTimes(2);
    s.time(35_000);
    await s.registry.reconcileDue();
    expect(s.query).toHaveBeenCalledTimes(3);
  });
  it('reconciles reordered unpublish with the current list, and same SID replacement stays bound', async () => {
    const s = setup();
    await s.registry.reconcileDue();
    s.time(5000);
    s.registry.markEvent({ roomName: 'room', identity: 'identity' });
    await s.registry.reconcileDue();
    expect(s.changed).toHaveBeenCalledTimes(1);
    expect(s.registry.validateTrack(owner, 'AUDIO')).toBe(true);
    s.remote({ ...participant(), tracks: [face, { ...audio, sid: 'NEW' }] });
    s.registry.markDirty(owner);
    expect(s.registry.validateTrack(owner, 'NEW')).toBe(false);
    s.time(10_000);
    await s.registry.reconcileDue();
    expect(s.registry.validateTrack(owner, 'AUDIO')).toBe(false);
    expect(s.registry.validateTrack(owner, 'NEW')).toBe(true);
  });
  it.each([
    [{ ...audio, source: TrackSource.SCREEN_SHARE_AUDIO }],
    [face, { ...face, sid: 'FACE2' }],
    [{ ...face, type: TrackType.AUDIO }],
  ])(
    'fails closed for prohibited sources, extra camera or source/type mismatch %j',
    async (...tracks) => {
      const s = setup();
      s.remote({ ...participant(), tracks });
      await s.registry.reconcileDue();
      expect(s.unauthorized).toHaveBeenCalledOnce();
      expect(s.registry.bindingFor(owner)).toBeNull();
      expect(s.registry.inspect(owner)?.terminal).toBe(true);
    },
  );
  it('retirement prevents an old query response from resurrecting a binding', async () => {
    let resolve!: (value: RemoteParticipant) => void;
    const registry = new TrackRegistry({
      now: () => 0,
      getParticipant: () =>
        new Promise((done) => {
          resolve = done;
        }),
      onChanged: vi.fn(),
      onUnauthorized: vi.fn(),
    });
    registry.register(owner);
    const pending = registry.reconcileDue();
    registry.retire(owner);
    resolve(participant());
    await pending;
    expect(registry.bindingFor(owner)).toBeNull();
  });
  it('does not trust a query invalidated by a newer event during its execution', async () => {
    let resolve!: (value: RemoteParticipant) => void;
    const registry = new TrackRegistry({
      now: () => 0,
      getParticipant: () =>
        new Promise((done) => {
          resolve = done;
        }),
      onChanged: vi.fn(),
      onUnauthorized: vi.fn(),
    });
    registry.register(owner);
    const pending = registry.reconcileDue();
    registry.markDirty(owner);
    resolve(participant());
    await pending;
    expect(registry.bindingFor(owner)).toBeNull();
    expect(registry.inspect(owner)?.dirty).toBe(true);
  });
  it('preserves previous confirmed tracks on query error but never grants a new track', async () => {
    const s = setup();
    await s.registry.reconcileDue();
    s.query.mockRejectedValueOnce(new Error('cloud unavailable'));
    s.registry.markDirty(owner);
    s.time(5000);
    await s.registry.reconcileDue();
    expect(s.registry.inspect(owner)?.dirty).toBe(true);
    expect(s.registry.validateTrack(owner, 'AUDIO')).toBe(true);
    expect(s.registry.validateTrack(owner, 'NEW')).toBe(false);
  });
  it('rejects a new participant SID under the same generation', async () => {
    const s = setup();
    await s.registry.reconcileDue();
    s.remote({ ...participant(), sid: 'PA_2' });
    s.registry.markDirty(owner);
    s.time(5000);
    await s.registry.reconcileDue();
    expect(s.unauthorized).toHaveBeenCalledWith(owner, 'PARTICIPANT_SID_CHANGED');
  });
  it('remembers the participant SID across absence and rejects a reconnect in the old generation', async () => {
    const s = setup();
    await s.registry.reconcileDue();
    s.remote(null);
    s.registry.markDirty(owner);
    s.time(5000);
    await s.registry.reconcileDue();
    expect(s.registry.bindingFor(owner)).toBeNull();
    expect(s.registry.validateTrack(owner, 'AUDIO')).toBe(false);

    s.remote({ ...participant(), sid: 'PA_RECONNECTED' });
    s.registry.markDirty(owner);
    s.time(10_000);
    await s.registry.reconcileDue();
    expect(s.unauthorized).toHaveBeenCalledWith(owner, 'PARTICIPANT_SID_CHANGED');
    expect(s.registry.bindingFor(owner)).toBeNull();
    expect(s.registry.inspect(owner)?.terminal).toBe(true);
  });
});
