// F-10 / QA-06 G1-C on E's real TrackRegistry + SubscriptionController: a publisher re-publishes
// its microphone as a new SID, replaces the track under the same SID, or replaces its whole
// connection (new identity/generation). A new SID starts blocked and is allowed only through the
// verified binding; the same SID keeps its relationship without a new approval; a full reconnect
// retires the old owner before the new one is accepted and never touches the other receivers.
// Cloud half (real SDK events, setSubscribed refusal): tests/cloud/g1-c.cloud.test.ts, BLOCKED until F-02.
import { describe, expect, it } from 'vitest';
import {
  flush,
  ownerOf,
  participant,
  receiverKey,
  registryWith,
  subscriptionHarness,
  trackHarness,
} from '../fixtures/media-recovery-scenarios.ts';

describe('G1-C: new SID, same-SID replace, full reconnect', () => {
  it('a new microphone SID is blocked by default: the old SID is unsubscribed before the new one can be allowed', async () => {
    const { generation } = registryWith(['r1', 't1']);
    const speaker = generation('r1');
    const owner = ownerOf(speaker);
    const tracks = trackHarness();
    tracks.registry.register(owner);
    tracks.remote.set(
      speaker.identity,
      participant('PA_r1', speaker.identity, [{ sid: 'AUDIO_1', source: 'microphone' }]),
    );
    await tracks.registry.reconcileDue();
    expect(tracks.registry.bindingFor(owner)).toMatchObject({
      audioTrackSid: 'AUDIO_1',
      participantSid: 'PA_r1',
    });
    const fp1 = tracks.registry.getTrackFingerprint(owner, 'AUDIO_1');
    expect(fp1).toContain('AUDIO_1');

    const listener = receiverKey('t1', generation('t1'));
    const subs = subscriptionHarness({ tracks: ['AUDIO_1'] });
    subs.desire(listener, 1, ['AUDIO_1']);
    await flush();
    subs.dispatched()[0]!.resolve();
    await flush();
    expect(subs.controller.inspect(listener)?.acknowledgedTracks).toEqual(['AUDIO_1']);

    // unpublish → publish: the participant now carries AUDIO_2 only.
    tracks.remote.set(
      speaker.identity,
      participant('PA_r1', speaker.identity, [{ sid: 'AUDIO_2', source: 'microphone' }]),
    );
    await tracks.event(owner);
    expect(tracks.registry.validateTrack(owner, 'AUDIO_1')).toBe(false);
    expect(tracks.registry.validateTrack(owner, 'AUDIO_2')).toBe(true);
    expect(tracks.changed.filter((i) => i === speaker.identity)).toHaveLength(2);
    // The receiver learns AUDIO_1 vanished: it is removed first, and AUDIO_2 stays blocked until policy names it.
    subs.validTracks.delete('AUDIO_1');
    subs.validTracks.add('AUDIO_2');
    subs.controller.drainPending();
    await flush();
    expect(subs.dispatched()[1]).toMatchObject({ subscribe: false, trackSids: ['AUDIO_1'] });
    subs.dispatched()[1]!.resolve();
    await flush();
    expect(subs.dispatched()).toHaveLength(2);
    subs.desire(listener, 2, ['AUDIO_2']);
    await flush();
    expect(subs.dispatched()[2]).toMatchObject({ subscribe: true, trackSids: ['AUDIO_2'] });
    subs.dispatched()[2]!.resolve();
    await flush();
    expect(subs.controller.inspect(listener)?.acknowledgedTracks).toEqual(['AUDIO_2']);
    subs.controller.dispose();
  });

  it('replaceTrack under the same SID keeps the binding and the allowed relationship; a denied receiver stays denied', async () => {
    const { generation } = registryWith(['r1', 't1', 't2']);
    const speaker = generation('r1');
    const owner = ownerOf(speaker);
    const tracks = trackHarness();
    tracks.registry.register(owner);
    tracks.remote.set(
      speaker.identity,
      participant('PA_r1', speaker.identity, [
        { sid: 'AUDIO_1', source: 'microphone' },
        { sid: 'FACE_1', source: 'camera' },
      ]),
    );
    await tracks.registry.reconcileDue();
    const before = tracks.registry.getTrackFingerprint(owner, 'AUDIO_1');
    const changes = tracks.changed.length;
    // Same SID, same participant: the query result is identical, so nothing changes downstream.
    await tracks.event(owner);
    expect(tracks.registry.getTrackFingerprint(owner, 'AUDIO_1')).toBe(before);
    expect(tracks.changed.length).toBe(changes);

    const allowed = receiverKey('t1', generation('t1'));
    const denied = receiverKey('t2', generation('t2'));
    const subs = subscriptionHarness({ tracks: ['AUDIO_1', 'FACE_1'] });
    subs.desire(allowed, 1, ['AUDIO_1']);
    subs.desire(denied, 1, []);
    await flush();
    expect(subs.dispatched()).toHaveLength(1);
    subs.dispatched()[0]!.resolve();
    await flush();
    // A replace does not require a webhook or a re-approval: no new request for the allowed side,
    // and the denied side is never subscribed.
    subs.controller.drainPending();
    await flush();
    expect(subs.dispatched()).toHaveLength(1);
    expect(subs.controller.inspect(allowed)?.acknowledgedTracks).toEqual(['AUDIO_1']);
    expect(subs.controller.inspect(denied)).toMatchObject({
      acknowledgedTracks: [],
      desiredTracks: [],
    });
    subs.controller.dispose();
  });

  it('a changed participant SID under the same identity is unauthorized, not adopted', async () => {
    const { generation } = registryWith(['r1']);
    const speaker = generation('r1');
    const owner = ownerOf(speaker);
    const tracks = trackHarness();
    tracks.registry.register(owner);
    tracks.remote.set(
      speaker.identity,
      participant('PA_r1', speaker.identity, [{ sid: 'AUDIO_1', source: 'microphone' }]),
    );
    await tracks.registry.reconcileDue();
    tracks.remote.set(
      speaker.identity,
      participant('PA_r1_reconnected', speaker.identity, [
        { sid: 'AUDIO_9', source: 'microphone' },
      ]),
    );
    await tracks.event(owner);
    expect(tracks.unauthorized).toEqual([
      { identity: speaker.identity, reason: 'PARTICIPANT_SID_CHANGED' },
    ]);
    expect(tracks.registry.inspect(owner)).toMatchObject({ terminal: true, bindings: [] });
    expect(tracks.registry.validateTrack(owner, 'AUDIO_9')).toBe(false);
  });

  it('one participant reconnects fully: the old owner must be retired first, the other receivers keep their generation, and the old response applies nowhere', async () => {
    const { registry, generation } = registryWith(['r1', 't1', 't2', 't3', 't4', 't5']);
    const old = generation('r1');
    const oldOwner = ownerOf(old);
    const tracks = trackHarness();
    tracks.registry.register(oldOwner);
    tracks.remote.set(
      old.identity,
      participant('PA_r1', old.identity, [{ sid: 'AUDIO_1', source: 'microphone' }]),
    );
    await tracks.registry.reconcileDue();
    const listeners = ['t1', 't2', 't3', 't4', 't5'].map((id) => receiverKey(id, generation(id)));
    const subs = subscriptionHarness({ tracks: ['AUDIO_1', 'AUDIO_2'] });
    for (const key of listeners) subs.desire(key, 1, ['AUDIO_1']);
    await flush();
    expect(subs.dispatched()).toHaveLength(5);
    // Only t1's allow is still unanswered when r1 replaces its connection.
    for (const sent of subs.dispatched().slice(1)) sent.resolve();
    await flush();
    const pendingOld = subs.dispatched()[0]!;

    // MC-08 order: the previous identity is retired before a new generation may register.
    old.terminal = true;
    old.state = 'REVOKED';
    const fresh = registry.allocate(
      { ...old.request, requestId: 'prepare-r1-2', expectedPreviousGeneration: 1 },
      1_800_000_001_000,
    );
    expect(fresh.generation).toBe(2);
    expect(fresh.identity).not.toBe(old.identity);
    const newOwner = ownerOf(fresh);
    expect(() => tracks.registry.register(newOwner)).toThrow('TRACK_OWNER_CONFLICT');
    tracks.registry.retire(oldOwner);
    tracks.registry.register(newOwner);
    tracks.remote.set(
      fresh.identity,
      participant('PA_r1_2', fresh.identity, [{ sid: 'AUDIO_2', source: 'microphone' }]),
    );
    await tracks.registry.reconcileDue();
    expect(tracks.registry.listBindings('m', 'game')).toEqual([
      expect.objectContaining({
        playerId: 'r1',
        publisherGeneration: 2,
        mediaIdentity: fresh.identity,
        participantSid: 'PA_r1_2',
        audioTrackSid: 'AUDIO_2',
      }),
    ]);
    // The other five receivers keep their receiverGeneration; only the publisher side changed.
    for (const key of listeners) expect(key.receiverGeneration).toBe(1);
    // The old SID is blocked everywhere before the new SID is allowed by the new binding.
    subs.validTracks.delete('AUDIO_1');
    for (const key of listeners) subs.desire(key, 2, ['AUDIO_2']);
    await flush();
    const afterSwap = subs.dispatched().slice(5);
    // t1 still had its allow in flight, so it gets nothing new yet; the four others unsubscribe AUDIO_1.
    expect(afterSwap).toHaveLength(4);
    for (const sent of afterSwap)
      expect(sent).toMatchObject({ subscribe: false, trackSids: ['AUDIO_1'] });
    for (const sent of afterSwap) sent.resolve();
    await flush();
    const allows = subs.dispatched().slice(9);
    expect(allows).toHaveLength(4);
    for (const sent of allows)
      expect(sent).toMatchObject({ subscribe: true, trackSids: ['AUDIO_2'] });
    // The stale old allow for t1 now answers: it is applied to nothing new, and t1 converges too.
    pendingOld.resolve();
    await flush();
    const t1Next = subs
      .dispatched()
      .filter((x) => x.key.playerId === 't1')
      .slice(1);
    expect(t1Next[0]).toMatchObject({ subscribe: false, trackSids: ['AUDIO_1'] });
    expect(subs.controller.inspect(listeners[0]!)?.acknowledgedTracks).toEqual(['AUDIO_1']);
    t1Next[0]!.resolve();
    await flush();
    expect(subs.controller.inspect(listeners[0]!)?.acknowledgedTracks).toEqual([]);
    subs.controller.dispose();
  });
});
