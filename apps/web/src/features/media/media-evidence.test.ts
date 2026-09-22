import { describe, expect, it } from 'vitest';

import { composeMediaEvidence, type EvidenceInput, type MediaEvidence } from './media-evidence';

const SCOPE = { matchId: 'm1', mediaInstanceId: 'mi1', receiverGeneration: 2 };

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    scope: SCOPE,
    generationState: 'live',
    published: [{ source: 'face', trackSid: 'self-face', serverConfirmed: true }],
    subscriptions: [{ trackSid: 'v1', kind: 'video', subscribed: true }],
    authorized: [{ trackSid: 'v1', playerId: 'p1' }],
    attachedFaces: [{ trackSid: 'v1', playerId: 'p1' }],
    pendingSids: [],
    policyVoices: [],
    routedSids: [],
    preferences: { volume: 1, muted: false, mutedPlayerIds: [] },
    remoteFaceLimit: 5,
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceInput> = {}): MediaEvidence {
  return composeMediaEvidence(input(overrides));
}

describe('composeMediaEvidence', () => {
  it('keeps the publish confirmation separate from SDK success', () => {
    const result = evidence({
      published: [
        { source: 'face', trackSid: 'self-face', serverConfirmed: false },
        { source: 'microphone', trackSid: 'self-mic', serverConfirmed: true },
      ],
    });

    expect(result.published.map((entry) => [entry.source, entry.serverConfirmed])).toEqual([
      ['face', false],
      ['microphone', true],
    ]);
  });

  it('records the actual subscription state rather than the intent', () => {
    const result = evidence({
      subscriptions: [
        { trackSid: 'v1', kind: 'video', subscribed: true },
        { trackSid: 'v2', kind: 'video', subscribed: false },
      ],
      authorized: [
        { trackSid: 'v1', playerId: 'p1' },
        { trackSid: 'v2', playerId: 'p2' },
      ],
      attachedFaces: [{ trackSid: 'v1', playerId: 'p1' }],
    });

    expect(result.received).toEqual([
      {
        trackSid: 'v1',
        kind: 'video',
        playerId: 'p1',
        subscribed: true,
        attached: true,
        pending: false,
        authorized: true,
      },
      {
        trackSid: 'v2',
        kind: 'video',
        playerId: 'p2',
        subscribed: false,
        attached: false,
        pending: false,
        authorized: true,
      },
    ]);
    expect(result.integrity.authorizedButUnsubscribed).toEqual(['v2']);
  });

  it('flags a subscription the server never authorised', () => {
    const result = evidence({
      subscriptions: [{ trackSid: 'ghost', kind: 'audio', subscribed: true }],
      authorized: [],
      attachedFaces: [],
    });

    expect(result.integrity.forbiddenButSubscribed).toEqual(['ghost']);
  });

  /** 이 시험이 이 모듈의 존재 이유다. */
  it('does not let a client mute hide an open subscription', () => {
    const muted = evidence({
      subscriptions: [{ trackSid: 'a1', kind: 'audio', subscribed: true }],
      authorized: [{ trackSid: 'a1', playerId: 'p1' }],
      attachedFaces: [],
      policyVoices: [{ playerId: 'p1', trackSid: 'a1', gain: 0.8 }],
      routedSids: ['a1'],
      preferences: { volume: 1, muted: false, mutedPlayerIds: ['p1'] },
    });

    // 사용자가 껐으므로 들리지는 않는다.
    expect(muted.voices[0]?.effectiveGain).toBe(0);
    expect(muted.voices[0]?.mutedByUser).toBe(true);
    // 그러나 구독은 열려 있고, 그 사실이 증거에 그대로 남는다.
    expect(muted.received[0]?.subscribed).toBe(true);
    expect(muted.integrity.mutedButSubscribed).toEqual(['a1']);
    // 허용된 트랙이므로 위반은 아니다. 두 목록을 섞지 않는다.
    expect(muted.integrity.forbiddenButSubscribed).toEqual([]);
  });

  it('keeps the policy gain visible even when the user silenced everything', () => {
    const result = evidence({
      policyVoices: [{ playerId: 'p1', trackSid: 'a1', gain: 0.6 }],
      preferences: { volume: 0.5, muted: true, mutedPlayerIds: [] },
    });

    expect(result.voices[0]?.policyGain).toBe(0.6);
    expect(result.voices[0]?.effectiveGain).toBe(0);
  });

  it('applies the user volume to the policy gain when nothing is muted', () => {
    const result = evidence({
      policyVoices: [{ playerId: 'p1', trackSid: 'a1', gain: 0.8 }],
      preferences: { volume: 0.5, muted: false, mutedPlayerIds: [] },
    });

    expect(result.voices[0]?.effectiveGain).toBeCloseTo(0.4, 6);
  });

  it('separates a routed voice from one the graph never connected', () => {
    const result = evidence({
      policyVoices: [
        { playerId: 'p1', trackSid: 'a1', gain: 0.5 },
        { playerId: 'p2', trackSid: 'a2', gain: 0.5 },
      ],
      routedSids: ['a1'],
    });

    expect(result.voices.map((voice) => voice.routed)).toEqual([true, false]);
  });

  it('marks a track still waiting for binding verification', () => {
    const result = evidence({
      subscriptions: [{ trackSid: 'v9', kind: 'video', subscribed: true }],
      authorized: [],
      attachedFaces: [],
      pendingSids: ['v9'],
    });

    expect(result.received[0]).toMatchObject({ pending: true, attached: false, authorized: false });
  });

  it('counts attached faces against the instance limit', () => {
    const result = evidence({
      remoteFaceLimit: 2,
      attachedFaces: [
        { trackSid: 'v1', playerId: 'p1' },
        { trackSid: 'v2', playerId: 'p2' },
        { trackSid: 'v3', playerId: 'p3' },
      ],
    });

    expect(result.attachedFaceCount).toBe(3);
    expect(result.attachedFaceCount).toBeGreaterThan(result.remoteFaceLimit);
  });

  it('reports a face attached without a binding', () => {
    const result = evidence({
      subscriptions: [{ trackSid: 'v1', kind: 'video', subscribed: true }],
      authorized: [],
      attachedFaces: [{ trackSid: 'v1', playerId: 'p1' }],
    });

    expect(result.received).toContainEqual(
      expect.objectContaining({ trackSid: 'v1', attached: true, authorized: false }),
    );
  });

  it('is clean for a healthy generation', () => {
    const healthy = evidence();
    expect(healthy.integrity.forbiddenButSubscribed).toEqual([]);
    expect(healthy.attachedFaceCount).toBeLessThanOrEqual(healthy.remoteFaceLimit);
    expect(healthy.received.filter((e) => e.attached && !e.authorized)).toEqual([]);
  });

  it('carries the scope and generation state through unchanged', () => {
    const result = evidence({ generationState: 'terminal' });

    expect(result.scope).toEqual(SCOPE);
    expect(result.generationState).toBe('terminal');
  });

  it('treats a non-finite gain as silence rather than propagating it', () => {
    const result = evidence({
      policyVoices: [{ playerId: 'p1', trackSid: 'a1', gain: Number.NaN }],
    });

    expect(result.voices[0]?.policyGain).toBe(0);
    expect(result.voices[0]?.effectiveGain).toBe(0);
  });
});
