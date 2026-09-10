import { describe, expect, it } from 'vitest';

import {
  firstBindings,
  onePublisherReconnected,
} from '../../../../../docs/execution/contracts/fixtures';
import { createBindingStore, isSelfPublishConfirmed, type MediaBindings } from './media-bindings';

const SELF = 'p1';

const bindings = (over: Partial<MediaBindings> = {}): MediaBindings => ({
  matchId: 'match-1',
  mediaInstanceId: 'instance-1',
  receiverGeneration: 1,
  bindingRevision: 1,
  participants: [
    {
      playerId: SELF,
      publisherGeneration: 1,
      mediaIdentity: 'identity-p1-g1',
      participantSid: 'PA_1',
      faceTrackSid: 'TR_face_1',
    },
    {
      playerId: 'p2',
      publisherGeneration: 1,
      mediaIdentity: 'identity-p2-g1',
      participantSid: 'PA_2',
      faceTrackSid: 'TR_face_2',
      audioTrackSid: 'TR_audio_2',
    },
  ],
  ...over,
});

describe('createBindingStore', () => {
  it('keeps the granted generation when an older or unrelated binding arrives late', () => {
    const store = createBindingStore();
    const approved = bindings({ receiverGeneration: 2, bindingRevision: 5 });
    store.beginScope(approved);
    expect(store.apply(approved, SELF).status).toBe('applied');
    for (const stale of [
      bindings(),
      bindings({ mediaInstanceId: 'other' }),
      bindings({ receiverGeneration: 3 }),
    ])
      expect(store.apply(stale, SELF)).toEqual({ status: 'ignored', reason: 'WRONG_SCOPE' });
    expect(store.getScope()?.receiverGeneration).toBe(2);
    expect(store.getRevision()).toBe(5);
  });
  it('applies a well formed list and separates self from remote', () => {
    const store = createBindingStore();

    expect(store.apply(bindings(), SELF).status).toBe('applied');

    expect(store.getSelf()?.playerId).toBe(SELF);
    expect(store.getRemote().map((entry) => entry.playerId)).toEqual(['p2']);
    expect(store.getRevision()).toBe(1);
  });

  it('consumes the shared contract fixture', () => {
    const store = createBindingStore();
    const result = store.apply(firstBindings as unknown as MediaBindings, SELF);

    expect(result.status).toBe('applied');
    expect(store.getRemote().length).toBeGreaterThan(0);
    expect(store.getRemote().every((entry) => entry.playerId !== SELF)).toBe(true);
  });

  it('ignores an equal or lower revision in the same scope', () => {
    const store = createBindingStore();
    store.apply(bindings({ bindingRevision: 5 }), SELF);

    expect(store.apply(bindings({ bindingRevision: 5 }), SELF)).toEqual({
      status: 'ignored',
      reason: 'STALE_REVISION',
    });
    expect(store.apply(bindings({ bindingRevision: 4 }), SELF)).toEqual({
      status: 'ignored',
      reason: 'STALE_REVISION',
    });
    expect(store.getRevision()).toBe(5);
  });

  it('accepts a lower revision after the receiver generation changed', () => {
    const store = createBindingStore();
    store.apply(bindings({ bindingRevision: 9 }), SELF);

    // 승인된 grant로 세대를 연 뒤에만 revision을 새로 센다.
    store.beginScope({ matchId: 'match-1', mediaInstanceId: 'instance-1', receiverGeneration: 2 });
    const result = store.apply(bindings({ receiverGeneration: 2, bindingRevision: 1 }), SELF);

    expect(result.status).toBe('applied');
    expect(store.getScope()!.receiverGeneration).toBe(2);
    expect(store.getRevision()).toBe(1);
  });

  it('rejects a malformed participant entry instead of guessing', () => {
    const store = createBindingStore();

    expect(store.apply(bindings({ participants: [{ playerId: 'p2' } as never] }), SELF)).toEqual({
      status: 'ignored',
      reason: 'MALFORMED',
    });
    expect(store.apply({ ...bindings(), bindingRevision: Number.NaN }, SELF)).toEqual({
      status: 'ignored',
      reason: 'MALFORMED',
    });
    expect(store.getRemote()).toHaveLength(0);
  });

  it('maps a track only by the published faceTrackSid, never by a name', () => {
    const store = createBindingStore();
    store.apply(bindings(), SELF);

    expect(store.findByFaceTrack('TR_face_2')?.playerId).toBe('p2');
    expect(store.findByFaceTrack('TR_unknown')).toBeNull();
    expect(store.findByFaceTrack('')).toBeNull();
    // 자기 얼굴 트랙은 원격 매핑 대상이 아니다.
    expect(store.findByFaceTrack('TR_face_1')).toBeNull();
    expect(store.findByAudioTrack('TR_audio_2')?.playerId).toBe('p2');
  });

  it('replaces the whole allow list instead of merging', () => {
    const store = createBindingStore();
    store.apply(bindings(), SELF);

    store.apply(
      bindings({
        bindingRevision: 2,
        participants: [
          {
            playerId: 'p3',
            publisherGeneration: 1,
            mediaIdentity: 'identity-p3-g1',
            participantSid: 'PA_3',
            faceTrackSid: 'TR_face_3',
          },
        ],
      }),
      SELF,
    );

    expect(store.getRemote().map((entry) => entry.playerId)).toEqual(['p3']);
    expect(store.findByFaceTrack('TR_face_2')).toBeNull();
    expect(store.getSelf()).toBeNull();
  });

  it('changes only the reconnected publisher generation from the shared fixture', () => {
    const store = createBindingStore();
    store.apply(firstBindings as unknown as MediaBindings, SELF);
    const before = store
      .getRemote()
      .map((entry) => `${entry.playerId}:${entry.publisherGeneration}`);

    store.apply(onePublisherReconnected as unknown as MediaBindings, SELF);
    const after = store
      .getRemote()
      .map((entry) => `${entry.playerId}:${entry.publisherGeneration}`);

    expect(after).not.toEqual(before);
    const changed = after.filter((entry, index) => entry !== before[index]);
    expect(changed).toHaveLength(1);
  });

  it('clears everything on reset', () => {
    const store = createBindingStore();
    store.apply(bindings(), SELF);

    store.reset();

    expect(store.getScope()).toBeNull();
    expect(store.getRemote()).toHaveLength(0);
    expect(store.getSelf()).toBeNull();
    expect(store.getRevision()).toBe(-1);
  });
});

describe('isSelfPublishConfirmed', () => {
  it('requires the self generation to equal the receiver generation and the sid to match', () => {
    const store = createBindingStore();
    store.apply(bindings(), SELF);
    const scope = store.getScope();

    expect(isSelfPublishConfirmed(store.getSelf(), scope, 'TR_face_1')).toBe(true);
    expect(isSelfPublishConfirmed(store.getSelf(), scope, 'TR_other')).toBe(false);
    expect(isSelfPublishConfirmed(null, scope, 'TR_face_1')).toBe(false);
    expect(isSelfPublishConfirmed(store.getSelf(), scope, null)).toBe(false);
  });

  it('refuses a self entry whose publisher generation lags the receiver generation', () => {
    const store = createBindingStore();
    store.apply(
      bindings({
        participants: [
          {
            playerId: SELF,
            publisherGeneration: 0,
            mediaIdentity: 'identity-p1-g0',
            participantSid: 'PA_1',
            faceTrackSid: 'TR_face_1',
          },
        ],
      }),
      SELF,
    );

    expect(isSelfPublishConfirmed(store.getSelf(), store.getScope(), 'TR_face_1')).toBe(false);
  });
});
