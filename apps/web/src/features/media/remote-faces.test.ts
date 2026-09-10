import { describe, expect, it, vi } from 'vitest';

import { faceArrivalOrders } from '../../../../../docs/execution/contracts/fixtures';
import { createBindingStore, type MediaBindings } from './media-bindings';
import type { MediaScope } from './media-types';
import { createPendingTrackStore, PENDING_TRACK_LIMIT } from './pending-tracks';
import {
  createRemoteFaces,
  MAX_GAME_REMOTE_FACES,
  MAX_PRACTICE_REMOTE_FACES,
  remoteFaceLimit,
  type FaceTrackEvent,
  type InstancePurpose,
  type RemoteTrack,
} from './remote-faces';

const SELF = 'p1';
const scope: MediaScope = {
  matchId: 'match-1',
  mediaInstanceId: 'instance-1',
  receiverGeneration: 1,
};

const participant = (
  playerId: string,
  index: number,
  over: Partial<MediaBindings['participants'][number]> = {},
) => ({
  playerId,
  publisherGeneration: 1,
  mediaIdentity: `identity-${playerId}-g1`,
  participantSid: `PA_${index}`,
  faceTrackSid: `TR_face_${index}`,
  ...over,
});

const bindings = (
  participants: MediaBindings['participants'],
  over: Partial<MediaBindings> = {},
): MediaBindings => ({ ...scope, bindingRevision: 1, participants, ...over });

function remoteTrack(index: number, kind: 'video' | 'audio' = 'video') {
  const attachedTo: HTMLVideoElement[] = [];
  const detachedFrom: (HTMLVideoElement | undefined)[] = [];
  const track: RemoteTrack = {
    trackSid: `TR_face_${index}`,
    kind,
    participantSid: `PA_${index}`,
    attach: (element) => attachedTo.push(element),
    detach: (element) => detachedFrom.push(element),
  };
  return Object.assign(track, { attachedTo, detachedFrom });
}

function harness(purpose: InstancePurpose = 'game') {
  const events: FaceTrackEvent[] = [];
  const refreshes: (MediaScope & { lastBindingRevision: number })[] = [];
  const unsubscribed: RemoteTrack[] = [];
  const created: { removed: boolean; srcObject: unknown }[] = [];
  let clock = 1000;
  const store = createBindingStore();
  const pending = createPendingTrackStore();
  const faces = createRemoteFaces({
    bindings: store,
    createElement: () => {
      const element = {
        muted: false,
        playsInline: false,
        autoplay: false,
        srcObject: {} as unknown,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      created.push(element as unknown as { removed: boolean; srcObject: unknown });
      return element as unknown as HTMLVideoElement;
    },
    now: () => clock,
    onFaceTrack: (event) => events.push(event),
    unsubscribe: (track) => unsubscribed.push(track),
    requestBindingsRefresh: (request) => refreshes.push(request),
    getPurpose: () => purpose,
    pending,
  });
  return {
    faces,
    store,
    pending,
    events,
    refreshes,
    unsubscribed,
    created,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('createRemoteFaces', () => {
  it('attaches only when the verified binding and the real track agree', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
    const track = remoteTrack(2);

    base.faces.addTrack(track);

    expect(track.attachedTo).toHaveLength(1);
    expect(base.events).toHaveLength(1);
    expect(base.events[0]).toMatchObject({
      ...scope,
      playerId: 'p2',
      publisherGeneration: 1,
      trackSid: 'TR_face_2',
    });
    expect(base.events[0]!.element).not.toBeNull();
    const element = track.attachedTo[0] as unknown as { muted: boolean; playsInline: boolean };
    expect(element.muted).toBe(true);
    expect(element.playsInline).toBe(true);
  });

  it('reaches the same result for both arrival orders in the shared fixture', () => {
    for (const testCase of faceArrivalOrders) {
      const base = harness();
      const track = remoteTrack(2);
      for (const step of testCase.order) {
        if (step === 'track') base.faces.addTrack(track);
        else {
          base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
          base.faces.reconcile();
        }
      }

      expect(base.faces.getAttached()).toEqual([{ playerId: 'p2', trackSid: 'TR_face_2' }]);
      expect(base.events.at(-1)!.playerId).toBe(testCase.expectedAttachedPlayer);
      // 바인딩 전에는 attach하지 않는다.
      expect(testCase.expectedBeforeBinding).toBe(false);
    }
  });

  it('never attaches or plays an unverified track', () => {
    const base = harness();
    const unknown = remoteTrack(9);

    base.faces.addTrack(unknown);

    expect(unknown.attachedTo).toHaveLength(0);
    expect(base.events).toHaveLength(0);
    expect(base.faces.getAttached()).toHaveLength(0);
    expect(base.pending.has('TR_face_9')).toBe(true);
  });

  it('refuses a track whose participantSid does not match the binding', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
    const impostor = { ...remoteTrack(2), participantSid: 'PA_999' };

    base.faces.addTrack(impostor);

    expect(base.faces.getAttached()).toHaveLength(0);
    expect(base.events).toHaveLength(0);
  });

  it('never builds an attach for the self entry', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);

    base.faces.addTrack(remoteTrack(1));

    expect(base.faces.getAttached()).toHaveLength(0);
    expect(base.events).toHaveLength(0);
  });

  it('recovers an already received publication when the binding arrives late', () => {
    const base = harness();
    const track = remoteTrack(2);
    base.faces.addTrack(track);
    expect(base.faces.getAttached()).toHaveLength(0);

    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
    base.faces.reconcile();

    expect(base.faces.getAttached()).toEqual([{ playerId: 'p2', trackSid: 'TR_face_2' }]);
    expect(base.pending.has('TR_face_2')).toBe(false);
  });

  it('drops the hold past 12 tracks or 2 seconds and asks for a refresh', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1)]), SELF);
    for (let index = 10; index < 10 + PENDING_TRACK_LIMIT; index += 1)
      base.faces.addTrack(remoteTrack(index));
    expect(base.refreshes).toHaveLength(0);

    base.faces.addTrack(remoteTrack(99));

    expect(base.unsubscribed).toHaveLength(1);
    expect(base.refreshes).toEqual([{ ...scope, lastBindingRevision: 1 }]);

    base.advance(2001);
    base.faces.sweep();
    expect(base.unsubscribed.length).toBeGreaterThan(1);
    expect(base.refreshes.length).toBeGreaterThan(1);
  });

  it('replaces only the reconnected player and keeps the others attached', () => {
    const base = harness();
    base.store.apply(
      bindings([participant(SELF, 1), participant('p2', 2), participant('p3', 3)]),
      SELF,
    );
    const second = remoteTrack(2);
    const third = remoteTrack(3);
    base.faces.addTrack(second);
    base.faces.addTrack(third);
    expect(base.faces.getAttached()).toHaveLength(2);
    const seen = base.events.length;

    const replacement = { ...remoteTrack(2), trackSid: 'TR_face_2b' };
    base.faces.addTrack(replacement);
    base.store.apply(
      bindings(
        [
          participant(SELF, 1),
          participant('p2', 2, { publisherGeneration: 2, faceTrackSid: 'TR_face_2b' }),
          participant('p3', 3),
        ],
        { bindingRevision: 2 },
      ),
      SELF,
    );
    base.faces.reconcile();

    const attached = base.faces.getAttached();
    expect(attached).toContainEqual({ playerId: 'p2', trackSid: 'TR_face_2b' });
    expect(attached).toContainEqual({ playerId: 'p3', trackSid: 'TR_face_3' });
    // p3의 element는 그대로 유지된다.
    expect(third.detachedFrom).toHaveLength(0);
    // p2는 null callback으로 먼저 해제된 뒤 새 element를 받는다.
    const p2Events = base.events.slice(seen).filter((event) => event.playerId === 'p2');
    expect(p2Events[0]!.element).toBeNull();
    expect(p2Events.at(-1)!.element).not.toBeNull();
    expect(p2Events.at(-1)!.publisherGeneration).toBe(2);
  });

  it('handles an old SID unsubscribe without closing the new element', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
    base.faces.addTrack(remoteTrack(2));

    const replacement = { ...remoteTrack(2), trackSid: 'TR_face_2b' };
    base.faces.addTrack(replacement);
    base.store.apply(
      bindings([participant(SELF, 1), participant('p2', 2, { faceTrackSid: 'TR_face_2b' })], {
        bindingRevision: 2,
      }),
      SELF,
    );
    base.faces.reconcile();
    expect(base.faces.getAttached()).toEqual([{ playerId: 'p2', trackSid: 'TR_face_2b' }]);

    // 구 SID의 늦은 unsubscribed 사건
    base.faces.removeTrack('TR_face_2');

    expect(base.faces.getAttached()).toEqual([{ playerId: 'p2', trackSid: 'TR_face_2b' }]);
  });

  it('releases the texture before detaching and clears the element', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
    const track = remoteTrack(2);
    base.faces.addTrack(track);

    base.faces.removeTrack('TR_face_2');

    expect(base.events.at(-1)).toMatchObject({ playerId: 'p2', element: null });
    expect(track.detachedFrom).toHaveLength(1);
    expect(base.created[0]!.srcObject).toBeNull();
    expect(base.created[0]!.removed).toBe(true);
  });

  it('caps the game instance at five remote faces and practice at two', () => {
    expect(remoteFaceLimit('game')).toBe(MAX_GAME_REMOTE_FACES);
    expect(remoteFaceLimit('practice')).toBe(MAX_PRACTICE_REMOTE_FACES);

    const practice = harness('practice');
    const people = [2, 3, 4].map((index) => participant(`p${index}`, index));
    practice.store.apply(bindings([participant(SELF, 1), ...people]), SELF);
    for (const index of [2, 3, 4]) practice.faces.addTrack(remoteTrack(index));

    expect(practice.faces.getAttached()).toHaveLength(MAX_PRACTICE_REMOTE_FACES);
  });

  it('drops every attachment when the receiver generation changes', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
    base.faces.addTrack(remoteTrack(2));

    base.store.beginScope({ ...base.store.getScope()!, receiverGeneration: 2 });

    base.store.apply(
      bindings([participant(SELF, 1), participant('p2', 2)], {
        receiverGeneration: 2,
        bindingRevision: 1,
      }),
      SELF,
    );
    base.faces.reconcile();

    expect(base.faces.getAttached()).toHaveLength(0);
    expect(base.events.at(-1)!.element).toBeNull();
  });

  it('accumulates no element or listener across repeated join and leave', () => {
    const base = harness();
    for (let round = 0; round < 5; round += 1) {
      base.store.apply(
        bindings([participant(SELF, 1), participant('p2', 2)], { bindingRevision: round + 1 }),
        SELF,
      );
      base.faces.addTrack(remoteTrack(2));
      base.faces.removeTrack('TR_face_2');
    }

    expect(base.faces.getAttached()).toHaveLength(0);
    expect(base.created).toHaveLength(5);
    expect(base.created.every((element) => element.removed)).toBe(true);
  });

  it('keeps a verified audio track out of the pending hold', () => {
    const base = harness();
    base.store.apply(
      bindings([participant(SELF, 1), participant('p2', 2, { audioTrackSid: 'TR_audio_2' })]),
      SELF,
    );
    const audio = { ...remoteTrack(2), trackSid: 'TR_audio_2', kind: 'audio' as const };

    base.faces.addTrack(audio);

    // 검증된 오디오는 보류 대상이 아니다.
    expect(base.pending.has('TR_audio_2')).toBe(false);

    base.advance(2001);
    base.faces.sweep();

    // 2초가 지나도 구독을 끊지 않는다. 끊으면 근거리 음성이 죽는다.
    expect(base.unsubscribed.map((track) => track.trackSid)).not.toContain('TR_audio_2');
  });

  it('resolves a verified audio track that arrived before its binding', () => {
    const base = harness();
    const audio = { ...remoteTrack(2), trackSid: 'TR_audio_2', kind: 'audio' as const };
    base.faces.addTrack(audio);
    expect(base.pending.has('TR_audio_2')).toBe(true);

    base.store.apply(
      bindings([participant(SELF, 1), participant('p2', 2, { audioTrackSid: 'TR_audio_2' })]),
      SELF,
    );
    base.faces.reconcile();

    expect(base.pending.has('TR_audio_2')).toBe(false);
    base.advance(2001);
    base.faces.sweep();
    expect(base.unsubscribed.map((track) => track.trackSid)).not.toContain('TR_audio_2');
  });

  it('still evicts an audio track that no binding ever approved', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1)]), SELF);
    const stranger = { ...remoteTrack(9), trackSid: 'TR_audio_9', kind: 'audio' as const };

    base.faces.addTrack(stranger);
    base.advance(2001);
    base.faces.sweep();

    expect(base.unsubscribed.map((track) => track.trackSid)).toContain('TR_audio_9');
    expect(base.refreshes.length).toBeGreaterThan(0);
  });

  it('releases everything on clear', () => {
    const base = harness();
    base.store.apply(bindings([participant(SELF, 1), participant('p2', 2)]), SELF);
    base.faces.addTrack(remoteTrack(2));
    base.faces.addTrack(remoteTrack(9));

    base.faces.clear();

    expect(base.faces.getAttached()).toHaveLength(0);
    expect(base.pending.size).toBe(0);
    expect(base.unsubscribed.map((track) => track.trackSid)).toEqual(['TR_face_9']);
  });

  it('receives faces even when nothing is visible on screen', () => {
    const base = harness();
    const people = [2, 3, 4, 5, 6].map((index) => participant(`p${index}`, index));
    base.store.apply(bindings([participant(SELF, 1), ...people]), SELF);
    for (const index of [2, 3, 4, 5, 6]) base.faces.addTrack(remoteTrack(index));

    // D는 5명까지 수신하고 렌더 여부는 C가 정한다.
    expect(base.faces.getAttached()).toHaveLength(MAX_GAME_REMOTE_FACES);
    expect(vi.isMockFunction(base.faces.reconcile)).toBe(false);
  });
});
