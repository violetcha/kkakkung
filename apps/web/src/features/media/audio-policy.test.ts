import { describe, expect, it } from 'vitest';

import { audioPolicy as sharedPolicy } from '../../../../../docs/execution/contracts/fixtures';
import { createPolicyStore, FUTURE_POLICY_HOLD_MS, type AudioPolicy } from './audio-policy';
import { createBindingStore, type MediaBindings } from './media-bindings';

const SELF = 'p1';
const scope = { matchId: 'match-1', mediaInstanceId: 'instance-1', receiverGeneration: 1 };

const bindings = (over: Partial<MediaBindings> = {}): MediaBindings => ({
  ...scope,
  bindingRevision: 3,
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

const policy = (over: Partial<AudioPolicy> = {}): AudioPolicy => ({
  ...scope,
  policyRevision: 1,
  bindingRevision: 3,
  stateVersion: 10,
  voices: [{ playerId: 'p2', trackSid: 'TR_audio_2', gain: 0.8, azimuthRad: 0.4, lowpassHz: 4000 }],
  effects: [],
  ...over,
});

function harness() {
  const store = createBindingStore();
  store.apply(bindings(), SELF);
  return { bindings: store, policies: createPolicyStore(store) };
}

describe('createPolicyStore', () => {
  it('applies a policy that references the current binding revision', () => {
    const base = harness();

    expect(base.policies.apply(policy()).status).toBe('applied');
    expect(base.policies.resolveVoices()).toEqual([
      {
        playerId: 'p2',
        trackSid: 'TR_audio_2',
        gain: 0.8,
        azimuthRad: 0.4,
        lowpassHz: 4000,
        publisherGeneration: 1,
        participantSid: 'PA_2',
      },
    ]);
  });

  it('accepts the shared contract policy fixture shape', () => {
    const base = harness();
    const shared = sharedPolicy as unknown as AudioPolicy;

    // 공유 fixture는 다른 scope일 수 있으므로 모양 검사만 확인한다.
    const result = base.policies.apply(shared);
    expect(['applied', 'ignored', 'held']).toContain(result.status);
    if (result.status === 'ignored') expect(result.reason).not.toBe('MALFORMED');
  });

  it('discards an equal or lower policy revision', () => {
    const base = harness();
    base.policies.apply(policy({ policyRevision: 5 }));

    expect(base.policies.apply(policy({ policyRevision: 5 }))).toEqual({
      status: 'ignored',
      reason: 'STALE_POLICY',
    });
    expect(base.policies.apply(policy({ policyRevision: 4 }))).toEqual({
      status: 'ignored',
      reason: 'STALE_POLICY',
    });
  });

  it('discards a policy from another instance or receiver generation', () => {
    const base = harness();

    expect(base.policies.apply(policy({ receiverGeneration: 2 }))).toEqual({
      status: 'ignored',
      reason: 'WRONG_SCOPE',
    });
    expect(base.policies.apply(policy({ mediaInstanceId: 'other' }))).toEqual({
      status: 'ignored',
      reason: 'WRONG_SCOPE',
    });
    expect(base.policies.resolveVoices()).toHaveLength(0);
  });

  it('discards a policy that references a past binding revision', () => {
    const base = harness();

    expect(base.policies.apply(policy({ bindingRevision: 2 }))).toEqual({
      status: 'ignored',
      reason: 'PAST_BINDING',
    });
  });

  it('holds a future policy and applies it once the binding catches up', () => {
    const base = harness();

    const held = base.policies.apply(policy({ bindingRevision: 4 }));
    expect(held.status).toBe('held');
    expect(base.policies.resolveVoices()).toHaveLength(0);

    base.bindings.apply(bindings({ bindingRevision: 4 }), SELF);
    const revisited = base.policies.revisit(0);

    expect(revisited?.status).toBe('applied');
    expect(base.policies.resolveVoices()).toHaveLength(1);
  });

  it('drops the held policy after the 2 second hold', () => {
    const base = harness();
    base.policies.apply(policy({ bindingRevision: 4 }));

    expect(base.policies.revisit(FUTURE_POLICY_HOLD_MS + 1)).toBeNull();
    expect(base.policies.getPolicy()).toBeNull();
  });

  it('keeps only the newest held policy', () => {
    const base = harness();
    base.policies.apply(policy({ policyRevision: 1, bindingRevision: 4 }));
    base.policies.apply(policy({ policyRevision: 2, bindingRevision: 4 }));

    base.bindings.apply(bindings({ bindingRevision: 4 }), SELF);
    const revisited = base.policies.revisit(0);

    expect(revisited?.status).toBe('applied');
    expect(base.policies.getPolicy()!.policyRevision).toBe(2);
  });

  it('refuses a voice whose trackSid is not the verified audioTrackSid', () => {
    const base = harness();
    base.policies.apply(
      policy({
        voices: [
          { playerId: 'p2', trackSid: 'TR_wrong', gain: 0.8, azimuthRad: 0, lowpassHz: 4000 },
        ],
      }),
    );

    expect(base.policies.resolveVoices()).toHaveLength(0);
  });

  it('refuses a voice for a player without a verified audio binding', () => {
    const base = harness();
    base.policies.apply(
      policy({
        voices: [
          { playerId: 'p9', trackSid: 'TR_audio_9', gain: 0.8, azimuthRad: 0, lowpassHz: 4000 },
        ],
      }),
    );

    expect(base.policies.resolveVoices()).toHaveLength(0);
  });

  it('rejects a NaN gain or a malformed voice instead of playing it', () => {
    const base = harness();

    expect(
      base.policies.apply(
        policy({
          voices: [
            {
              playerId: 'p2',
              trackSid: 'TR_audio_2',
              gain: Number.NaN,
              azimuthRad: 0,
              lowpassHz: 4000,
            },
          ],
        }),
      ),
    ).toEqual({ status: 'ignored', reason: 'MALFORMED' });
    expect(base.policies.resolveVoices()).toHaveLength(0);
  });

  it('never reads a publisherGeneration field from the voice itself', () => {
    const base = harness();
    base.policies.apply(
      policy({
        voices: [
          {
            playerId: 'p2',
            trackSid: 'TR_audio_2',
            gain: 0.5,
            azimuthRad: 0,
            lowpassHz: 3000,
            publisherGeneration: 99,
          } as never,
        ],
      }),
    );

    // 세대는 참조 바인딩에서만 온다.
    expect(base.policies.resolveVoices()[0]!.publisherGeneration).toBe(1);
  });

  it('mutes immediately when the binding revision moves past the applied policy', () => {
    const base = harness();
    base.policies.apply(policy());
    expect(base.policies.resolveVoices()).toHaveLength(1);

    base.bindings.apply(bindings({ bindingRevision: 4 }), SELF);

    // 오래된 정책으로 새 SID를 재생하지 않는다.
    expect(base.policies.resolveVoices()).toHaveLength(0);
  });

  it('treats an empty newest voices list as an immediate close', () => {
    const base = harness();
    base.policies.apply(policy());

    base.policies.apply(policy({ policyRevision: 2, voices: [] }));

    expect(base.policies.resolveVoices()).toHaveLength(0);
  });

  it('exposes the approved effects and clears on reset', () => {
    const base = harness();
    base.policies.apply(
      policy({
        effects: [
          {
            eventId: 'ev-1',
            kind: 'footstep',
            gain: 0.5,
            azimuthRad: 0,
            lowpassHz: 5000,
            tick: 10,
          },
        ],
      }),
    );

    expect(base.policies.getEffects()).toHaveLength(1);
    base.policies.reset();
    expect(base.policies.getEffects()).toHaveLength(0);
    expect(base.policies.getPolicy()).toBeNull();
  });

  it('rejects a malformed effect entry', () => {
    const base = harness();

    expect(base.policies.apply(policy({ effects: [{ eventId: 'ev-1' } as never] }))).toEqual({
      status: 'ignored',
      reason: 'MALFORMED',
    });
  });
});
