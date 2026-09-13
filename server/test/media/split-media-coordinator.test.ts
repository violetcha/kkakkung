import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParticipantInfo, TrackInfo } from 'livekit-server-sdk';
import { splitCoordinatorFixture } from './split-coordinator-fixture.js';
import { deferred, flush } from './generation-fixtures.js';
import type { MediaBindings, AudioPolicy } from '../../src/media/types.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(capacity = 100, players = 2) {
  const f = await splitCoordinatorFixture(capacity, players);
  cleanups.push(f.close);
  await f.open();
  return f;
}
const lastBindings = (f: Awaited<ReturnType<typeof setup>>, player: string) =>
  vi
    .mocked(f.deps.enqueueBindings)
    .mock.calls.filter(([id]) => id === player)
    .at(-1)?.[1] as MediaBindings | undefined;
const lastAudio = (f: Awaited<ReturnType<typeof setup>>, player: string) =>
  vi
    .mocked(f.deps.enqueueAudioPolicy)
    .mock.calls.filter(([id]) => id === player)
    .at(-1)?.[1] as AudioPolicy | undefined;

describe('actual split media factory with durable files and controlled Cloud transport', () => {
  it('removes originals but keeps issuance and accounting blocked after a transport-unknown forward', async () => {
    const f = await setup();
    const a = await f.prepare(0);
    const b = await f.prepare(1);
    f.publish(a.grant);
    f.publish(b.grant);
    const original = f.forward.getMockImplementation()!;
    f.forward.mockImplementationOnce(async (...args) => {
      await original(...args);
      throw { code: 'deadline_exceeded' };
    });
    await f.coordinator.reconcile();
    await vi.waitFor(
      () => expect(f.coordinator.getReadiness().unresolvedCount).toBeGreaterThan(0),
      { timeout: 3000, interval: 5 },
    );
    await vi.waitFor(() => expect(f.remote.size).toBe(0), { timeout: 3000, interval: 5 });
    expect(f.coordinator.canIssue()).toBe(false);
    expect(f.removeRoom).not.toHaveBeenCalled();
    const usage = JSON.parse(
      await fs.readFile(path.join(f.directory, 'usage-checkpoint.json'), 'utf8'),
    );
    expect(
      usage.state.reservations.every(
        (reservation: { status: string }) => reservation.status !== 'RELEASED',
      ),
    ).toBe(true);
  });

  it('connects six full pairs within the conservative 72-resource ceiling and cleans all seven rooms', async () => {
    const f = await setup(72, 6);
    const grants = await Promise.all(Array.from({ length: 6 }, (_, player) => f.prepare(player)));
    // Reproduce CI's earlier absent lookup before either original connection is published.
    // Both signed join events must refresh their independent owners after that observation.
    await f.coordinator.reconcile();
    expect(f.remote.size).toBe(0);
    for (const result of grants) f.publish(result.grant);
    f.clock.offset += 5001;
    for (const result of grants) await f.announce(result.grant);
    await f.coordinator.reconcile();
    expect(f.remote.size).toBe(72);
    expect(f.rooms.size).toBe(7);
    for (const result of grants) {
      expect(lastBindings(f, result.playerId)?.participants).toHaveLength(6);
      expect(lastAudio(f, result.playerId)?.voices).toHaveLength(5);
    }
    const results = await Promise.all(grants.map((grant) => f.retire(grant)));
    expect(results.every((result) => result.status === 'confirmed')).toBe(true);
    expect(f.remote.size).toBe(0);
    expect(f.rooms.size).toBe(0);
    expect(new Set(f.removeRoom.mock.calls.map(([room]) => room)).size).toBe(7);
    const usage = JSON.parse(
      await fs.readFile(path.join(f.directory, 'usage-checkpoint.json'), 'utf8'),
    );
    expect(usage.state.reservations).toHaveLength(12);
    expect(
      usage.state.reservations.every(
        (reservation: { status: string }) => reservation.status === 'RELEASED',
      ),
    ).toBe(true);
  });

  it('requires both source connections and publishes destination-verified face/audio bindings', async () => {
    const f = await setup();
    const a = await f.prepare(0);
    const b = await f.prepare(1);
    f.publish(a.grant, true);
    f.publish(b.grant, true);
    await f.coordinator.reconcile();
    expect(f.forward).not.toHaveBeenCalled();
    f.publish(a.grant);
    f.publish(b.grant);
    f.clock.offset += 5001;
    await f.announce(a.grant);
    await f.announce(b.grant);
    await f.coordinator.reconcile();
    expect(f.forward).toHaveBeenCalledTimes(4);
    const peer = lastBindings(f, 'p1')?.participants.find((binding) => binding.playerId === 'p0');
    expect(peer).toMatchObject({
      mediaIdentity: a.grant.mediaIdentity,
      participantSid: expect.stringMatching(/^CLONE_PARTICIPANT_/),
      facePublisher: {
        mediaIdentity: a.grant.facePublication!.mediaIdentity,
        participantSid: expect.stringMatching(/^CLONE_PARTICIPANT_/),
      },
      faceTrackSid: expect.stringMatching(/^CLONE_TRACK_/),
      audioTrackSid: expect.stringMatching(/^CLONE_TRACK_/),
    });
    expect(lastAudio(f, 'p1')?.voices[0]?.trackSid).toBe(peer?.audioTrackSid);
    expect(lastAudio(f, 'p1')?.publisherPermissions).toBeUndefined();
    expect(f.remote.size).toBe(8);
    expect(f.subscriptions).not.toHaveBeenCalled();
  });

  it('keeps faces while server distance blocks audio, then permits a fresh same-destination reallow', async () => {
    const f = await setup();
    const a = await f.prepare(0);
    const b = await f.prepare(1);
    f.publish(a.grant);
    f.publish(b.grant);
    await f.coordinator.reconcile();
    const before = lastBindings(f, 'p1')!.participants.find((entry) => entry.playerId === 'p0')!;
    const far = {
      ...f.frame,
      frameRevision: 2,
      participants: f.frame.participants.map((p, i) => ({ ...p, cell: { x: i * 7, y: 0 } })),
    };
    f.coordinator.observeFrame(far);
    await f.coordinator.reconcile();
    const blocked = lastBindings(f, 'p1')!.participants.find((entry) => entry.playerId === 'p0')!;
    expect(blocked.faceTrackSid).toBe(before.faceTrackSid);
    expect(blocked.audioTrackSid).toBeUndefined();
    expect(lastAudio(f, 'p1')?.voices).toEqual([]);
    expect(f.remote.has(f.key(b.grant.roomName, a.grant.mediaIdentity))).toBe(false);
    expect(f.remote.has(f.key(a.grant.roomName, a.grant.mediaIdentity))).toBe(true);
    f.coordinator.observeFrame({ ...f.frame, frameRevision: 3 });
    await f.coordinator.reconcile();
    const after = lastBindings(f, 'p1')!.participants.find((entry) => entry.playerId === 'p0')!;
    expect(after.audioTrackSid).toBeTruthy();
    expect(after.audioTrackSid).not.toBe(before.audioTrackSid);
    expect(after.faceTrackSid).toBe(before.faceTrackSid);
    expect(f.coordinator.getReadiness().state).toBe('READY');
  });

  it('retires all outgoing and incoming edges without deleting another active player’s rooms', async () => {
    const f = await setup();
    const a = await f.prepare(0);
    const b = await f.prepare(1);
    f.publish(a.grant);
    f.publish(b.grant);
    await f.coordinator.reconcile();
    expect(await f.retire(a)).toMatchObject({ status: 'confirmed' });
    expect(f.remote.size).toBe(2);
    expect(f.remote.has(f.key(b.grant.roomName, b.grant.mediaIdentity))).toBe(true);
    expect(
      f.remote.has(
        f.key(b.grant.facePublication!.roomName, b.grant.facePublication!.mediaIdentity),
      ),
    ).toBe(true);
    expect(f.removeRoom).not.toHaveBeenCalled();
    const usage = JSON.parse(
      await fs.readFile(path.join(f.directory, 'usage-checkpoint.json'), 'utf8'),
    );
    expect(usage.state.reservations.map((r: { status: string }) => r.status).sort()).toEqual([
      'ACTIVE',
      'RELEASED',
    ]);
    expect(await f.retire(b)).toMatchObject({ status: 'confirmed' });
    expect(f.remote.size).toBe(0);
    expect(f.rooms.size).toBe(0);
    expect(new Set(f.removeRoom.mock.calls.map(([room]) => room)).size).toBe(3);
  });

  it('reserves potential original and clone capacity before another player can receive a grant', async () => {
    const f = await setup(7);
    const a = await f.prepare(0);
    const b = await f.coordinator.prepareGeneration(f.request(1));
    expect(b).toMatchObject({ status: 'rejected', grant: null, code: 'NOT_READY' });
    expect(await f.retire(a)).toMatchObject({ status: 'confirmed' });
    expect(
      (
        await f.coordinator.prepareGeneration({
          ...f.request(1),
          requestId: 'after-capacity-released',
        })
      ).status,
    ).toBe('ready');
  });

  it('revokes originals promptly but waits for a known late forward before reporting retirement confirmed', async () => {
    const f = await setup();
    const a = await f.prepare(0);
    const b = await f.prepare(1);
    f.publish(a.grant);
    f.publish(b.grant);
    const gate = deferred<void>();
    cleanups.push(async () => {
      gate.resolve();
      await flush();
    });
    f.forward.mockImplementationOnce(async (room, identity, destination) => {
      const origin = await f.get(room, identity);
      const clone = new ParticipantInfo({
        identity,
        sid: 'LATE_CLONE',
        tracks: origin.tracks.map((t) => new TrackInfo({ ...t, sid: 'LATE_TRACK' })),
      });
      await gate.promise;
      f.remote.set(f.key(destination, identity), clone);
      return clone;
    });
    const reconcile = f.coordinator.reconcile();
    await vi.waitFor(() => expect(f.forward).toHaveBeenCalled(), { timeout: 1000, interval: 5 });
    let retired = false;
    const retirement = f.retire(a).then((result) => {
      retired = true;
      return result;
    });
    await vi.waitFor(
      () => expect(f.remote.has(f.key(a.grant.roomName, a.grant.mediaIdentity))).toBe(false),
      { timeout: 1000, interval: 5 },
    );
    expect(retired).toBe(false);
    gate.resolve();
    await reconcile;
    expect(await retirement).toMatchObject({ status: 'confirmed' });
    expect([...f.remote.values()].some((participant) => participant.sid === 'LATE_CLONE')).toBe(
      false,
    );
  });
});
