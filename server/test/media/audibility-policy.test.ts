import { describe, expect, it } from 'vitest';
import { AudibilityPolicy, shortestAcousticPaths } from '../../src/media/AudibilityPolicy.js';
import { AudioProjection } from '../../src/media/AudioProjection.js';
import type { GameSubject, MediaBindings, TrustedMediaFrame } from '../../src/media/types.js';

function player(playerId: string, x: number): GameSubject {
  return { playerId, role: 'runner', status: 'ACTIVE', cell: { x, y: 0 }, dir: 1, action: null };
}
function frame(distance: number, revision = 1): TrustedMediaFrame {
  return {
    matchId: 'm',
    mediaInstanceId: 'i',
    instancePurpose: 'game',
    frameRevision: revision,
    tick: revision,
    phase: 'PLAYING',
    topology: {
      topologyVersion: 'v',
      width: 10,
      height: 1,
      walkable: Array.from({ length: 10 }, () => true),
    },
    participants: [player('receiver', 0), player('sender', distance)],
    events: [],
  };
}

describe('path-based audibility', () => {
  it('rechecks changed walls, movement, orientation and retirement after routes are warm', () => {
    const policy = new AudibilityPolicy();
    const first = frame(2);
    expect(policy.observe(first)!.receivers[0]!.voices[0]!.gain).toBeCloseTo(1 / 3);
    const turned = {
      ...frame(2, 2),
      participants: [{ ...player('receiver', 0), dir: 0 as const }, player('sender', 2)],
    };
    expect(policy.observe(turned)!.receivers[0]!.voices[0]!.azimuthRad).toBeCloseTo(Math.PI / 2);
    first.topology.walkable[1] = false;
    expect(policy.observe({ ...first, frameRevision: 3 })!.receivers[0]!.voices).toEqual([]);
    first.topology.walkable[1] = true;
    expect(
      policy.observe({
        ...first,
        frameRevision: 4,
        participants: [player('receiver', 1), player('sender', 2)],
      })!.receivers[0]!.voices[0]!.gain,
    ).toBeCloseTo(1 / 2);
    policy.forget('m', 'i');
    expect(policy.observe(frame(6))!.receivers[0]!.voices).toEqual([]);
  });

  it('maintains exact 5 -> 6 -> 7 -> 6 -> 5 hysteresis', () => {
    const policy = new AudibilityPolicy();
    const observed = [5, 6, 7, 6, 5].map(
      (distance, index) => policy.observe(frame(distance, index + 1))!.receivers[0]!.voices.length,
    );
    expect(observed).toEqual([1, 1, 0, 0, 1]);
    expect(policy.observe(frame(5, 3))).toBeNull();
  });
  it('never substitutes straight-line distance for a seven-cell detour', () => {
    const input = frame(2);
    const result = new AudibilityPolicy().observe({
      ...input,
      topology: {
        topologyVersion: 'detour',
        width: 3,
        height: 4,
        walkable: [true, false, true, true, false, true, true, false, true, true, true, true],
      },
    });
    expect(result!.receivers[0]!.voices).toEqual([]);
  });
  it('counts corners on a shortest path and clamps acoustic outputs', () => {
    const topology = {
      topologyVersion: 'corner',
      width: 3,
      height: 2,
      walkable: [true, true, false, false, true, true],
    };
    expect(shortestAcousticPaths(topology, { x: 0, y: 0 }).get('2,1')).toEqual({
      distance: 3,
      corners: 2,
    });
    const policy = new AudibilityPolicy({
      distanceGain: () => 10,
      cornerGain: 0.5,
      clearLowpassHz: 100_000,
      cornerLowpassFactor: 0.5,
    });
    expect(policy.observe(frame(1))!.receivers[0]!.voices[0]).toEqual({
      playerId: 'sender',
      gain: 1,
      azimuthRad: 0,
      lowpassHz: 20_000,
    });
  });
  it('delivers completed footsteps only inside path four; turns are silent', () => {
    const policy = new AudibilityPolicy();
    const atFour = frame(4);
    const event = {
      eventId: 'step',
      tick: 1,
      kind: 'footstep' as const,
      cell: { x: 4, y: 0 },
      sourcePlayerId: 'sender',
    };
    expect(policy.observe({ ...atFour, events: [event] })!.receivers[0]!.effects).toHaveLength(1);
    const atFive = frame(5, 2);
    expect(
      policy.observe({ ...atFive, events: [{ ...event, tick: 2, cell: { x: 5, y: 0 } }] })!
        .receivers[0]!.effects,
    ).toHaveLength(0);
    const turning = {
      ...player('sender', 4),
      action: {
        kind: 'turn' as const,
        from: { x: 4, y: 0, dir: 1 as const },
        to: { x: 4, y: 0, dir: 2 as const },
        startTick: 0,
        endTick: 3,
      },
    };
    expect(
      policy.observe({
        ...frame(4, 3),
        participants: [player('receiver', 0), turning],
        events: [{ ...event, tick: 3 }],
      })!.receivers[0]!.effects,
    ).toHaveLength(0);
  });
  it('removes escaped participants, cross-team practice and ended round outputs', () => {
    const policy = new AudibilityPolicy();
    expect(
      policy.observe({
        ...frame(2),
        instancePurpose: 'practice',
        participants: [player('receiver', 0), { ...player('sender', 2), role: 'tagger' }],
      })!.receivers[0]!.voices,
    ).toEqual([]);
    expect(
      policy.observe({
        ...frame(2, 2),
        participants: [player('receiver', 0), { ...player('sender', 2), status: 'ESCAPED' }],
      })!.receivers[0]!.voices,
    ).toEqual([]);
    expect(policy.observe({ ...frame(2, 3), phase: 'RESULT' })!.receivers[0]!.voices).toEqual([]);
  });
  it('projects only verified audio SIDs and sound values; revisions replace prior output', () => {
    const policy = new AudibilityPolicy();
    const projection = new AudioProjection();
    const observed = policy.observe(frame(2))!;
    const bindings: MediaBindings = {
      matchId: 'm',
      mediaInstanceId: 'i',
      receiverGeneration: 1,
      bindingRevision: 1,
      participants: [],
    };
    const first = projection.project(observed, 'receiver', bindings)!;
    expect(first.voices).toEqual([]);
    const current = {
      ...bindings,
      bindingRevision: 2,
      participants: [
        {
          playerId: 'sender',
          publisherGeneration: 3,
          mediaIdentity: 'opaque',
          participantSid: 'PA_1',
          audioTrackSid: 'TR_1',
        },
      ],
    };
    const result = projection.project(observed, 'receiver', current)!;
    expect(result.policyRevision).toBe(2);
    expect(result.voices[0]!.trackSid).toBe('TR_1');
    expect(projection.project(observed, 'receiver', current)).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/cell|topology|"x"|"y"|path/);
    expect(
      projection.project(observed, 'receiver', { ...current, mediaInstanceId: 'other' }),
    ).toBeNull();
  });
});

it('projects per-track outgoing permissions and renews leases on unchanged authoritative frames', () => {
  const audible = new AudibilityPolicy();
  const projection = new AudioProjection();
  const bindings: MediaBindings = {
    matchId: 'm',
    mediaInstanceId: 'i',
    receiverGeneration: 1,
    bindingRevision: 1,
    participants: [
      {
        playerId: 'receiver',
        publisherGeneration: 1,
        mediaIdentity: 'self',
        participantSid: 'PA_self',
        faceTrackSid: 'TR_face',
        audioTrackSid: 'TR_audio',
      },
      {
        playerId: 'sender',
        publisherGeneration: 2,
        mediaIdentity: 'other-generation-2',
        participantSid: 'PA_other',
        audioTrackSid: 'TR_other',
      },
    ],
  };
  const first = projection.project(audible.observe(frame(2))!, 'receiver', bindings, true)!;
  expect(first.publisherPermissions).toEqual([
    { participantIdentity: 'other-generation-2', allowedTrackSids: ['TR_face', 'TR_audio'] },
  ]);
  const heartbeat = projection.project(audible.observe(frame(2, 2))!, 'receiver', bindings, true)!;
  expect(heartbeat.policyRevision).toBe(first.policyRevision + 1);
  expect(heartbeat.publisherPermissions).toEqual(first.publisherPermissions);
  const distant = projection.project(audible.observe(frame(9, 3))!, 'receiver', bindings, true)!;
  expect(distant.publisherPermissions).toEqual([
    { participantIdentity: 'other-generation-2', allowedTrackSids: ['TR_face'] },
  ]);
  const retired = projection.project(
    audible.observe(frame(9, 4))!,
    'receiver',
    { ...bindings, bindingRevision: 2, participants: bindings.participants.slice(0, 1) },
    true,
  )!;
  expect(retired.publisherPermissions).toEqual([]);
});

// S15P21C204-269. A spectating ended runner listens from its target's cell and hears exactly what
// the target hears; an ended runner the frame does not list as a spectator stays silent.
describe('spectators', () => {
  const ended = (playerId: string, x: number): GameSubject => ({
    ...player(playerId, x),
    status: 'CAPTURED',
  });
  const spectating = (revision: number, spectators: TrustedMediaFrame['spectators']) => ({
    ...frame(0, revision),
    participants: [
      ended('watcher', 9),
      player('target', 0),
      player('near', 2),
      { ...player('tagger', 4), role: 'tagger' as const },
    ],
    spectators,
  });

  it('hears through the target: same senders, same distances, never the target itself', () => {
    const policy = new AudibilityPolicy();
    const result = policy.observe(spectating(1, [{ playerId: 'watcher', targetId: 'target' }]))!;
    const byId = new Map(result.receivers.map((r) => [r.playerId, r]));
    const target = byId.get('target')!;
    const watcher = byId.get('watcher')!;
    expect(target.voices.map((v) => v.playerId).sort()).toEqual(['near', 'tagger']);
    expect(watcher.voices.map((v) => v.playerId).sort()).toEqual(['near', 'tagger']);
    for (const voice of watcher.voices) {
      const same = target.voices.find((v) => v.playerId === voice.playerId)!;
      expect(voice.gain).toBeCloseTo(same.gain);
      expect(voice.azimuthRad).toBeCloseTo(same.azimuthRad);
    }
    // Nobody hears the ended runner: only ACTIVE senders are audible.
    for (const receiver of result.receivers)
      expect(receiver.voices.some((v) => v.playerId === 'watcher')).toBe(false);
  });

  it('keeps an unlisted ended runner silent and follows a target change', () => {
    const policy = new AudibilityPolicy();
    const silent = policy.observe(spectating(1, []))!;
    expect(silent.receivers.find((r) => r.playerId === 'watcher')!.voices).toEqual([]);
    const moved = policy.observe(spectating(2, [{ playerId: 'watcher', targetId: 'near' }]))!;
    const watcher = moved.receivers.find((r) => r.playerId === 'watcher')!;
    expect(watcher.voices.map((v) => v.playerId).sort()).toEqual(['tagger', 'target']);
  });
});
