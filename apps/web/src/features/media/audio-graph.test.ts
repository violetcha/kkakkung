import { describe, expect, it, vi } from 'vitest';

import { audioArrivalOrders } from '../../../../../docs/execution/contracts/fixtures';
import {
  createAudioGraph,
  type AudioGraphEnvironment,
  type FilterLike,
  type GainLike,
  type PannerLike,
  type SourceLike,
} from './audio-graph';
import type { AudioEffect, ResolvedVoice } from './audio-policy';
import { createPolicyStore, type AudioPolicy } from './audio-policy';
import { createBindingStore, type MediaBindings } from './media-bindings';

const SELF = 'p1';
const scope = { matchId: 'match-1', mediaInstanceId: 'instance-1', receiverGeneration: 1 };

const voice = (over: Partial<ResolvedVoice> = {}): ResolvedVoice => ({
  playerId: 'p2',
  trackSid: 'TR_audio_2',
  gain: 0.8,
  azimuthRad: 0.4,
  lowpassHz: 4000,
  publisherGeneration: 1,
  participantSid: 'PA_2',
  ...over,
});

function node<T extends object>(extra: T) {
  const connections: unknown[] = [];
  return Object.assign(
    {
      connect: (target: unknown) => connections.push(target),
      disconnect: vi.fn(),
      connections,
    },
    extra,
  );
}

function harness(tracks: Record<string, MediaStreamTrack | null> = {}) {
  const sources: (SourceLike & { started: boolean; stopped: boolean })[] = [];
  const effectSources: (SourceLike & { kind: string })[] = [];
  const effectEnds: (() => void)[] = [];
  const masterGain = node({ gainValue: 1 }) as unknown as GainLike;
  const environment: AudioGraphEnvironment = {
    createSourceFromTrack: () => {
      const source = node({
        started: false,
        stopped: false,
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
      });
      sources.push(source as unknown as SourceLike & { started: boolean; stopped: boolean });
      return source as unknown as SourceLike;
    },
    createEffectSource: (kind) => {
      const source = node({
        kind,
        start: () => undefined,
        stop: vi.fn(),
        onEnded: (listener: (() => void) | null) => {
          if (listener) effectEnds.push(listener);
        },
      });
      effectSources.push(source as unknown as SourceLike & { kind: string });
      return source as unknown as SourceLike;
    },
    createGain: () => node({ gainValue: 1 }) as unknown as GainLike,
    createFilter: () => node({ frequency: 0 }) as unknown as FilterLike,
    createPanner: () => node({ azimuthRad: 0 }) as unknown as PannerLike,
    destination: node({}) as never,
    masterGain,
  };
  const graph = createAudioGraph({
    environment,
    getAudioTrack: (trackSid) =>
      trackSid in tracks ? tracks[trackSid]! : ({ kind: 'audio' } as unknown as MediaStreamTrack),
  });
  return {
    graph,
    sources,
    effectSources,
    effectEnds,
    masterGain,
    environment,
    arriveTrack: (trackSid: string) => {
      tracks[trackSid] = { kind: 'audio' } as unknown as MediaStreamTrack;
    },
  };
}

const effect = (over: Partial<AudioEffect> = {}): AudioEffect => ({
  eventId: 'ev-1',
  kind: 'footstep',
  gain: 0.6,
  azimuthRad: 0.2,
  lowpassHz: 5000,
  tick: 100,
  ...over,
});

describe('createAudioGraph', () => {
  it('builds one Source to Filter to Gain to Panner chain per verified voice', () => {
    const base = harness();

    base.graph.reconcileVoices([voice()]);

    expect(base.graph.getVoices()).toHaveLength(1);
    expect(base.sources).toHaveLength(1);
    expect(base.sources[0]!.started).toBe(true);
    const chain = base.graph.getVoices()[0]!;
    expect(chain.filter.frequency).toBe(4000);
    expect(chain.gain.gainValue).toBe(0.8);
    expect(chain.panner.azimuthRad).toBe(0.4);
  });

  it('does not rebuild the graph when the same voice policy arrives twice', () => {
    const base = harness();
    base.graph.reconcileVoices([voice()]);

    base.graph.reconcileVoices([voice({ gain: 0.3 })]);

    expect(base.sources).toHaveLength(1);
    expect(base.graph.getVoices()).toHaveLength(1);
    expect(base.graph.getVoices()[0]!.gain.gainValue).toBe(0.3);
  });

  it('creates no graph when the verified SDK track is missing', () => {
    const base = harness({ TR_audio_2: null });

    base.graph.reconcileVoices([voice()]);

    expect(base.graph.getVoices()).toHaveLength(0);
    expect(base.sources).toHaveLength(0);
  });

  it('closes the output immediately when a voice leaves the policy', () => {
    const base = harness();
    base.graph.reconcileVoices([voice()]);
    const chain = base.graph.getVoices()[0]!;

    base.graph.reconcileVoices([]);

    expect(base.graph.getVoices()).toHaveLength(0);
    expect(chain.gain.disconnect).toHaveBeenCalled();
    expect(chain.panner.disconnect).toHaveBeenCalled();
  });

  it('rebuilds the chain when the publisher generation changes', () => {
    const base = harness();
    base.graph.reconcileVoices([voice()]);

    base.graph.reconcileVoices([voice({ publisherGeneration: 2 })]);

    expect(base.sources).toHaveLength(2);
    expect(base.graph.getVoices()[0]!.publisherGeneration).toBe(2);
  });

  it('locks the master output on countdown and reopens it later', () => {
    const base = harness();
    expect(base.masterGain.gainValue).toBe(0.7);

    base.graph.setOutputLock('locked');
    expect(base.masterGain.gainValue).toBe(0);

    base.graph.setOutputLock('open');
    expect(base.masterGain.gainValue).toBe(0.7);
  });

  it('keeps current policy and output locks authoritative when user settings change', () => {
    const base = harness();
    base.graph.reconcileVoices([voice()]);
    base.graph.setPreferences({ volume: 0.4, muted: false, mutedPlayerIds: ['p2'] });
    expect(base.masterGain.gainValue).toBe(0.4);
    expect(base.graph.getVoices()[0]!.gain.gainValue).toBe(0);
    base.graph.reconcileVoices([voice({ gain: 0.15 })]);
    base.graph.setOutputLock('locked');
    base.graph.setPreferences({ volume: 0.8, muted: false, mutedPlayerIds: [] });
    expect(base.masterGain.gainValue).toBe(0);
    expect(base.graph.getVoices()[0]!.gain.gainValue).toBe(0.15);
    base.graph.setPreferences({ volume: 0.8, muted: true, mutedPlayerIds: [] });
    base.graph.setOutputLock('open');
    expect(base.masterGain.gainValue).toBe(0);
    base.graph.reconcileVoices([]);
    base.graph.setPreferences({ volume: 0.4, muted: false, mutedPlayerIds: [] });
    expect(base.graph.getVoices()).toEqual([]);
    expect(base.sources).toHaveLength(1);
  });

  it('applies player mute on track arrival and generation changes without leaking it to another player', () => {
    const base = harness({ TR_audio_2: null });
    base.graph.setPreferences({ volume: 0.5, muted: false, mutedPlayerIds: ['p2'] });
    base.graph.reconcileVoices([voice()]);
    expect(base.sources).toHaveLength(0);
    base.arriveTrack('TR_audio_2');
    base.graph.reconcileVoices([voice()]);
    expect(base.graph.getVoices()[0]!.gain.gainValue).toBe(0);
    base.graph.reconcileVoices([voice({ publisherGeneration: 2 })]);
    expect(base.graph.getVoices()[0]!.gain.gainValue).toBe(0);
    base.graph.reconcileVoices([voice({ publisherGeneration: 2, playerId: 'p3' })]);
    expect(base.sources).toHaveLength(3);
    expect(base.sources[1]!.stopped).toBe(true);
    expect(base.graph.getVoices()[0]!.gain.gainValue).toBe(0.8);
  });

  it('clamps user volume and cannot reopen a disposed graph', () => {
    const base = harness();
    base.graph.setPreferences({ volume: Infinity, muted: false, mutedPlayerIds: [] });
    expect(base.masterGain.gainValue).toBe(0);
    base.graph.setPreferences({ volume: 2, muted: false, mutedPlayerIds: [] });
    expect(base.masterGain.gainValue).toBe(1);
    base.graph.dispose();
    base.graph.setOutputLock('locked');
    base.graph.setOutputLock('open');
    base.graph.setPreferences({ volume: 1, muted: false, mutedPlayerIds: [] });
    base.graph.reconcileVoices([voice()]);
    expect(base.masterGain.gainValue).toBe(0);
    expect(base.sources).toHaveLength(0);
  });

  it('plays an approved effect once per server eventId', () => {
    const base = harness();

    expect(base.graph.playEffects([effect()])).toEqual(['ev-1']);
    expect(base.graph.playEffects([effect()])).toEqual([]);
    expect(base.effectSources).toHaveLength(1);
  });

  it('plays no effect while the output is locked', () => {
    const base = harness();
    base.graph.setOutputLock('locked');

    expect(base.graph.playEffects([effect()])).toEqual([]);
    expect(base.effectSources).toHaveLength(0);
  });

  it('disconnects finished effect chains once and stops only still-playing effects on disposal', () => {
    const base = harness();
    const factories = [
      vi.spyOn(base.environment, 'createFilter'),
      vi.spyOn(base.environment, 'createGain'),
      vi.spyOn(base.environment, 'createPanner'),
    ];
    base.graph.playEffects([effect()]);
    base.effectEnds[0]!();
    expect(base.graph.playEffects([effect()])).toEqual([]);
    base.graph.playEffects([effect({ eventId: 'next' })]);
    base.graph.dispose();
    base.effectEnds[0]!(); // A delayed browser callback cannot double-disconnect.
    expect(base.effectSources[0]!.stop).not.toHaveBeenCalled();
    expect(base.effectSources[1]!.stop).toHaveBeenCalledOnce();
    for (const source of base.effectSources) expect(source.disconnect).toHaveBeenCalledOnce();
    for (const factory of factories)
      for (const result of factory.mock.results)
        expect(result.value.disconnect).toHaveBeenCalledOnce();
  });

  it('plays only the approved footstep, sensor and trap kinds', () => {
    const base = harness();

    base.graph.playEffects([
      effect({ eventId: 'a', kind: 'footstep' }),
      effect({ eventId: 'b', kind: 'sensor' }),
      effect({ eventId: 'c', kind: 'trap' }),
    ]);

    expect(base.effectSources.map((source) => source.kind)).toEqual(['footstep', 'sensor', 'trap']);
  });

  it('releases every node and effect source on dispose', () => {
    const base = harness();
    base.graph.reconcileVoices([voice()]);
    base.graph.playEffects([effect()]);
    const chain = base.graph.getVoices()[0]!;

    base.graph.dispose();
    base.graph.dispose();

    expect(base.graph.getVoices()).toHaveLength(0);
    expect(chain.source.disconnect).toHaveBeenCalled();
    expect(base.masterGain.gainValue).toBe(0);
    base.graph.reconcileVoices([voice()]);
    expect(base.graph.getVoices()).toHaveLength(0);
  });
});

describe('three input arrival orders', () => {
  const bindings = (over: Partial<MediaBindings> = {}): MediaBindings => ({
    ...scope,
    bindingRevision: 3,
    participants: [
      {
        playerId: SELF,
        publisherGeneration: 1,
        mediaIdentity: 'identity-p1-g1',
        participantSid: 'PA_1',
      },
      {
        playerId: 'p2',
        publisherGeneration: 1,
        mediaIdentity: 'identity-p2-g1',
        participantSid: 'PA_2',
        audioTrackSid: 'TR_audio_2',
      },
    ],
    ...over,
  });

  const policy = (): AudioPolicy => ({
    ...scope,
    policyRevision: 1,
    bindingRevision: 3,
    stateVersion: 10,
    voices: [
      { playerId: 'p2', trackSid: 'TR_audio_2', gain: 0.7, azimuthRad: 0.1, lowpassHz: 3500 },
    ],
    effects: [],
  });

  it('reaches the same graph for all six arrival orders with zero output before approval', () => {
    for (const order of audioArrivalOrders) {
      // 트랙은 실제로 도착한 뒤에만 조회된다.
      const base = harness({ TR_audio_2: null });
      const bindingStore = createBindingStore();
      const policyStore = createPolicyStore(bindingStore);
      const seen = new Set<string>();

      for (const step of order) {
        seen.add(step);
        if (step === 'bindings') bindingStore.apply(bindings(), SELF);
        if (step === 'policy') policyStore.apply(policy());
        if (step === 'track') base.arriveTrack('TR_audio_2');
        policyStore.revisit(0);
        base.graph.reconcileVoices(policyStore.resolveVoices());

        const approved = seen.has('bindings') && seen.has('policy') && seen.has('track');
        // 세 입력이 모두 오기 전에는 그래프도 출력도 없다.
        if (!approved) expect(base.graph.getVoices()).toHaveLength(0);
      }

      expect(base.graph.getVoices()).toHaveLength(1);
      expect(base.graph.getVoices()[0]!.trackSid).toBe('TR_audio_2');
      expect(base.graph.getVoices()[0]!.gain.gainValue).toBe(0.7);
      expect(base.sources).toHaveLength(1);
    }
  });
});
