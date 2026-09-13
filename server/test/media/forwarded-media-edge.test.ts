import { ParticipantInfo, Room, TrackInfo, TrackSource, TrackType } from 'livekit-server-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiBudget } from '../../src/operations/ApiBudget.js';
import { ForwardedMediaEdge, type ForwardSource } from '../../src/media/ForwardedMediaEdge.js';
import { LiveKitGateway, type GatewayClient } from '../../src/media/LiveKitGateway.js';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { deferred, flush, localConfiguration, prepareRequest } from './generation-fixtures.js';
import { localSplitCapability, splitPracticeFrame } from './split-fixtures.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};

function fixture(kind: 'face' | 'audio' = 'audio', normalLimit = 100) {
  let now = 0;
  let source: ForwardSource = { participantSid: 'ORIGIN_PARTICIPANT', trackSid: 'ORIGIN_TRACK' };
  let allowed = true;
  const epoch = 1_800_000_000_000;
  const config = localConfiguration(epoch);
  const registry = new MediaGenerationRegistry(config.namespace, false, 'split');
  registry.observe(splitPracticeFrame);
  const generations = [0, 1].map((index) =>
    registry.allocate(
      {
        ...prepareRequest,
        requestId: `p${index}`,
        playerId: `p${index}`,
      },
      epoch,
    ),
  );
  const [publisher, receiver] = generations;
  const timers = new Set<{ callback: () => void; at: number }>();
  const timer = (callback: () => void, milliseconds: number) => {
    const entry = { callback, at: now + milliseconds };
    timers.add(entry);
    return () => {
      timers.delete(entry);
    };
  };
  const api = new ApiBudget({
    monotonicNow: () => now,
    maxNormalCallsPer60s: normalLimit,
    maxTotalCallsPer60s: 200,
    setTimer: (callback, milliseconds) => timer(callback, milliseconds),
    clearTimer: (cancel) => (cancel as () => void)(),
  });
  const remote = new Map<string, ParticipantInfo>();
  const calls: string[] = [];
  let version = 0;
  const forward = vi.fn(async (_room: string, identity: string, destination: string) => {
    calls.push('forward');
    version++;
    const participant = new ParticipantInfo({
      identity,
      sid: `DEST_PARTICIPANT_${version}`,
      tracks: [
        new TrackInfo({
          sid: `DEST_TRACK_${version}`,
          source: kind === 'face' ? TrackSource.CAMERA : TrackSource.MICROPHONE,
          type: kind === 'face' ? TrackType.VIDEO : TrackType.AUDIO,
        }),
      ],
    });
    remote.set(`${destination}/${identity}`, participant);
    return participant;
  });
  const remove = vi.fn(async (room: string, identity: string) => {
    calls.push('remove');
    remote.delete(`${room}/${identity}`);
  });
  const get = vi.fn(async (room: string, identity: string) => {
    calls.push('get');
    if (
      room === (kind === 'face' ? publisher!.splitOwnership!.faceRoomName : publisher!.roomName) &&
      identity === (kind === 'face' ? publisher!.splitOwnership!.faceIdentity : publisher!.identity)
    )
      return new ParticipantInfo({
        identity,
        sid: source.participantSid,
        tracks: [
          new TrackInfo({
            sid: source.trackSid,
            source: kind === 'face' ? TrackSource.CAMERA : TrackSource.MICROPHONE,
            type: kind === 'face' ? TrackType.VIDEO : TrackType.AUDIO,
          }),
        ],
      });
    const participant = remote.get(`${room}/${identity}`);
    if (!participant) throw { code: 'not_found', status: 404 };
    return participant;
  });
  const client: GatewayClient = {
    forwardParticipant: forward,
    removeParticipant: remove,
    getParticipant: get,
    createRoom: async (input) => new Room({ name: input.name }),
    listRooms: async () => [],
    listParticipants: async () => [],
    deleteRoom: async () => {},
    updateParticipant: async () => new ParticipantInfo(),
    updateSubscriptions: async () => {},
  };
  const gateway = new LiveKitGateway(config, api, {
    monotonicNow: () => now,
    clientFactory: () => client,
  });
  const onChanged = vi.fn();
  const onFailure = vi.fn();
  const options = {
    publisher: publisher!,
    receiver: receiver!,
    kind,
    gateway,
    prepareForward: async () => ({ completeKnown: async () => {} }),
    capability: () => localSplitCapability(epoch),
    monotonicNow: () => now,
    epochNowSeconds: () => (epoch + now) / 1000,
    readSource: () => source,
    isAllowed: () => allowed,
    onChanged,
    onFailure,
    timer,
  };
  const edge = new ForwardedMediaEdge(options);
  cleanups.push(async () => {
    edge.retire();
    await edge.quiesce().catch(() => {});
    api.close();
  });
  return {
    edge,
    options,
    api,
    gateway,
    remote,
    calls,
    forward,
    remove,
    get,
    onFailure,
    onChanged,
    source: () => source,
    replaceSource: () => {
      source = { participantSid: 'ORIGIN_PARTICIPANT', trackSid: 'NEW_ORIGIN_TRACK' };
    },
    deny: () => {
      allowed = false;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
      for (const entry of [...timers])
        if (entry.at <= now) {
          timers.delete(entry);
          entry.callback();
        }
    },
  };
}

describe('server forwarding with real gateway/budget and controlled Cloud transport', () => {
  it('does not classify local durable preparation delay as an unanswered Cloud request', async () => {
    const f = fixture();
    const durable = deferred<void>();
    cleanups.push(async () => {
      durable.resolve();
      await settle();
    });
    f.options.prepareForward = async () => {
      await durable.promise;
      return { completeKnown: async () => {} };
    };
    f.edge.setDesired(f.source());
    await settle();
    f.advance(1500);
    expect(f.forward).not.toHaveBeenCalled();
    expect(f.onFailure).not.toHaveBeenCalled();
    durable.resolve();
    await f.edge.reconcile();
    expect(f.forward).toHaveBeenCalledOnce();
    expect(f.edge.binding).not.toBeNull();
    expect(f.onFailure).not.toHaveBeenCalled();
  });

  it('keeps acknowledged forwarding pending on durable completion without a false response timeout', async () => {
    const f = fixture();
    const durable = deferred<void>();
    cleanups.push(async () => {
      durable.resolve();
      await settle();
    });
    const completeKnown = vi.fn(async () => {
      await durable.promise;
    });
    f.options.prepareForward = async () => ({ completeKnown });
    f.edge.setDesired(f.source());
    await settle();
    expect(completeKnown).toHaveBeenCalledOnce();
    expect(f.forward).toHaveBeenCalledOnce();
    f.advance(1500);
    expect(f.onFailure).not.toHaveBeenCalled();
    expect(f.edge.binding).toBeNull();
    durable.resolve();
    await f.edge.reconcile();
    expect(f.edge.binding).not.toBeNull();
    expect(f.onFailure).not.toHaveBeenCalled();
  });

  it('retains the one-second security deadline while local completion is still pending', async () => {
    const f = fixture();
    const durable = deferred<void>();
    cleanups.push(async () => {
      durable.resolve();
      await settle();
    });
    f.options.prepareForward = async () => ({
      completeKnown: async () => {
        await durable.promise;
      },
    });
    f.edge.setDesired(f.source());
    await settle();
    expect(f.forward).toHaveBeenCalledOnce();
    f.edge.setDesired(null);
    f.advance(1001);
    expect(f.onFailure).toHaveBeenCalledExactlyOnceWith('BLOCK_TIMEOUT');
    durable.resolve();
    await f.edge.reconcile();
    expect(f.edge.binding).toBeNull();
    expect(f.remote.size).toBe(0);
  });

  it('removes a known forward without publishing bindings when durable completion fails', async () => {
    const f = fixture();
    f.options.prepareForward = async () => ({
      completeKnown: async () => {
        throw new Error('JOURNAL_NOT_WRITABLE');
      },
    });
    f.edge.setDesired(f.source());
    await f.edge.reconcile();
    expect(f.forward).toHaveBeenCalledOnce();
    expect(f.onFailure).toHaveBeenCalledExactlyOnceWith('FORWARD_EFFECT_UNCONFIRMED');
    expect(f.edge.binding).toBeNull();
    expect(f.remote.size).toBe(0);
  });

  it('waits for durable preparation, then settles a canceled-before-dispatch operation without forwarding', async () => {
    const f = fixture();
    const durable = deferred<void>();
    const completeKnown = vi.fn(async () => {});
    f.options.prepareForward = async () => {
      await durable.promise;
      return { completeKnown };
    };
    f.edge.setDesired(f.source());
    await settle();
    expect(f.forward).not.toHaveBeenCalled();
    f.edge.retire();
    durable.resolve();
    await f.edge.quiesce();
    expect(f.forward).not.toHaveBeenCalled();
    expect(completeKnown).toHaveBeenCalledOnce();
  });

  it('never sends a forward when write-ahead persistence fails', async () => {
    const f = fixture();
    f.options.prepareForward = async () => {
      throw new Error('JOURNAL_NOT_WRITABLE');
    };
    f.edge.setDesired(f.source());
    await settle();
    expect(f.forward).not.toHaveBeenCalled();
    expect(f.onFailure).toHaveBeenCalledOnce();
  });

  it('removes the clone when the origin changes during forwarding before publishing its binding', async () => {
    const f = fixture();
    const originalForward = f.forward.getMockImplementation()!;
    const originalGet = f.get.getMockImplementation()!;
    f.forward.mockImplementationOnce(async (...args) => {
      const clone = await originalForward(...args);
      f.get.mockImplementation(async (...getArgs) => {
        const participant = await originalGet(...getArgs);
        if (participant.sid === f.source().participantSid)
          participant.sid = 'REJOINED_DURING_FORWARD';
        return participant;
      });
      return clone;
    });
    f.edge.setDesired(f.source());
    await settle();
    expect(f.onChanged).not.toHaveBeenCalled();
    expect(f.onFailure).toHaveBeenCalledOnce();
    expect(f.remote.size).toBe(0);
    expect(f.edge.binding).toBeNull();
  });

  it('does not forward a rejoined origin hidden by an older local source snapshot', async () => {
    const f = fixture();
    const original = f.get.getMockImplementation()!;
    f.get.mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      result.sid = 'REJOINED_ORIGIN';
      return result;
    });
    f.edge.setDesired(f.source());
    await settle();
    expect(f.forward).not.toHaveBeenCalled();
    expect(f.onFailure).toHaveBeenCalledOnce();
    expect(f.edge.binding).toBeNull();
  });

  it('revalidates a destination notification without duplicating the forward and rejects an unexpected SID change', async () => {
    const f = fixture();
    f.edge.setDesired(f.source());
    await settle();
    f.edge.markDirty();
    await f.edge.reconcile();
    expect(f.forward).toHaveBeenCalledOnce();
    expect(f.onFailure).not.toHaveBeenCalled();
    [...f.remote.values()][0]!.sid = 'UNEXPECTED_DESTINATION_SID';
    f.edge.markDirty();
    await f.edge.reconcile();
    expect(f.onFailure).toHaveBeenCalledOnce();
    expect(f.edge.binding).toBeNull();
    expect(f.remote.size).toBe(0);
  });

  it.each(['face', 'audio'] as const)(
    'uses verified destination SIDs for %s, removes and reallows a fresh clone',
    async (kind) => {
      const f = fixture(kind);
      f.edge.setDesired(f.source());
      await settle();
      expect(f.edge.binding).toMatchObject({
        participantSid: 'DEST_PARTICIPANT_1',
        trackSid: 'DEST_TRACK_1',
      });
      f.edge.setDesired(f.source());
      await settle();
      expect(f.forward).toHaveBeenCalledOnce();
      f.edge.setDesired(null);
      expect(f.edge.binding).toBeNull();
      await settle();
      expect(f.remote.size).toBe(0);
      f.edge.setDesired(f.source());
      await settle();
      expect(f.edge.binding).toMatchObject({
        participantSid: 'DEST_PARTICIPANT_2',
        trackSid: 'DEST_TRACK_2',
      });
      expect(f.calls.filter((call) => call !== 'get')).toEqual(['forward', 'remove', 'forward']);
      expect(f.onFailure).not.toHaveBeenCalled();
    },
  );

  it('waits for an already-sent late forward and removes its effects before quiescence succeeds', async () => {
    const f = fixture();
    const original = f.forward.getMockImplementation()!;
    const gate = deferred<void>();
    f.forward.mockImplementationOnce(async (...args) => {
      await gate.promise;
      return original(...args);
    });
    f.edge.setDesired(f.source());
    await settle();
    f.edge.retire();
    let finished = false;
    const closing = f.edge.quiesce().then(() => {
      finished = true;
    });
    await settle();
    expect(finished).toBe(false);
    expect(f.remove).not.toHaveBeenCalled();
    gate.resolve();
    await closing;
    expect(f.calls.filter((call) => call !== 'get')).toEqual(['forward', 'remove']);
    expect(f.remote.size).toBe(0);
    expect(f.edge.binding).toBeNull();
    expect(f.onChanged).not.toHaveBeenCalled();
  });

  it('does not reuse an old in-flight allow across a block and same-source reallow', async () => {
    const f = fixture();
    const original = f.forward.getMockImplementation()!;
    const gate = deferred<void>();
    f.forward.mockImplementationOnce(async (...args) => {
      await gate.promise;
      return original(...args);
    });
    f.edge.setDesired(f.source());
    await settle();
    f.edge.setDesired(null);
    f.edge.setDesired(f.source());
    gate.resolve();
    await settle();
    expect(f.calls.filter((call) => call !== 'get')).toEqual(['forward', 'remove', 'forward']);
    expect(f.edge.binding?.participantSid).toBe('DEST_PARTICIPANT_2');
    expect(f.onFailure).not.toHaveBeenCalled();
    f.advance(1500);
    expect(f.onFailure).not.toHaveBeenCalled();
  });

  it('cleans an old publication before forwarding a replacement track', async () => {
    const f = fixture();
    f.edge.setDesired(f.source());
    await settle();
    f.replaceSource();
    f.edge.setDesired(f.source());
    await settle();
    expect(f.calls.filter((call) => call !== 'get')).toEqual(['forward', 'remove', 'forward']);
    expect(f.edge.binding?.trackSid).toBe('DEST_TRACK_2');
  });

  it('fences a response timeout immediately and still contains the later successful remote effect', async () => {
    const f = fixture();
    const original = f.forward.getMockImplementation()!;
    const gate = deferred<void>();
    f.forward.mockImplementationOnce(async (...args) => {
      await gate.promise;
      return original(...args);
    });
    f.edge.setDesired(f.source());
    await settle();
    f.advance(1001);
    expect(f.onFailure).toHaveBeenCalledOnce();
    expect(f.edge.binding).toBeNull();
    gate.resolve();
    await f.edge.quiesce();
    expect(f.remote.size).toBe(0);
  });

  it('retains a transport-unknown forward as unresolved even after a later absence observation', async () => {
    const f = fixture();
    const original = f.forward.getMockImplementation()!;
    f.forward.mockImplementationOnce(async (...args) => {
      await original(...args);
      throw { code: 'deadline_exceeded' };
    });
    f.edge.setDesired(f.source());
    await settle();
    expect(f.remote.size).toBe(0);
    await expect(f.edge.quiesce()).rejects.toThrow('FORWARD_EFFECT_UNCONFIRMED');
    expect(f.onFailure).toHaveBeenCalledOnce();
    f.edge.setDesired(f.source());
    await settle();
    expect(f.forward).toHaveBeenCalledOnce();
  });

  it('rejects an unexpected source in the destination instead of publishing a binding', async () => {
    const f = fixture();
    const original = f.forward.getMockImplementation()!;
    f.forward.mockImplementationOnce(async (...args) => {
      const participant = await original(...args);
      participant.tracks[0]!.source = TrackSource.SCREEN_SHARE;
      return participant;
    });
    f.edge.setDesired(f.source());
    await settle();
    expect(f.edge.binding).toBeNull();
    expect(f.onChanged).not.toHaveBeenCalled();
    expect(f.onFailure).toHaveBeenCalledOnce();
    expect(f.remote.size).toBe(0);
  });

  it('cancels a queued grant without calling the transport during retirement', async () => {
    const f = fixture('audio', 1);
    await f.gateway.listRooms([]);
    f.edge.setDesired(f.source());
    await settle();
    expect(f.api.getSnapshot().pendingNormal).toBe(1);
    f.edge.retire();
    await f.edge.quiesce();
    expect(f.forward).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.api.getSnapshot().pendingNormal).toBe(0);
  });

  it('does not confirm retirement while acknowledged cleanup still leaves a participant', async () => {
    const f = fixture();
    f.edge.setDesired(f.source());
    await settle();
    const original = f.remove.getMockImplementation()!;
    f.remove.mockImplementation(async () => {});
    f.edge.retire();
    await expect(f.edge.quiesce()).rejects.toThrow('FORWARD_EFFECT_UNCONFIRMED');
    expect(f.remote.size).toBe(1);
    f.remove.mockImplementation(original);
    await f.edge.quiesce();
    expect(f.remote.size).toBe(0);
  });

  it('rejects cross-scope or unowned destinations without any remote calls', () => {
    const f = fixture();
    expect(
      () =>
        new ForwardedMediaEdge({
          ...f.options,
          receiver: {
            ...f.options.receiver,
            roomName: 'foreign-room',
          },
        }),
    ).toThrow('INVALID_FORWARD_OWNERSHIP');
    expect(() => new ForwardedMediaEdge({ ...f.options, receiver: f.options.publisher })).toThrow(
      'INVALID_FORWARD_OWNERSHIP',
    );
    expect(f.forward).not.toHaveBeenCalled();
  });
});
