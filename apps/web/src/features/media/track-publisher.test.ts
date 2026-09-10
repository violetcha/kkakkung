import { describe, expect, it, vi } from 'vitest';

import {
  createFaceCompositor,
  type CompositorContext,
  type CompositorEnvironment,
} from './face-compositor';
import type { MediaScope } from './media-types';
import {
  createTrackPublisher,
  FACE_ENCODING,
  LOW_FACE_ENCODING,
  PublishRejectedError,
  type PublicationRecord,
  type PublisherPort,
} from './track-publisher';

const scope: MediaScope = {
  matchId: 'match-1',
  mediaInstanceId: 'instance-1',
  receiverGeneration: 1,
};

function track(kind: 'video' | 'audio') {
  return { kind, readyState: 'live', stop: vi.fn() } as unknown as MediaStreamTrack;
}

/** 실제 compositor가 만든 진짜 가공 handle. */
function processedHandle() {
  const context: CompositorContext = {
    fillStyle: '',
    filter: '',
    fillRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    drawImage: () => undefined,
  };
  const processedTrack = track('video');
  const environment: CompositorEnvironment = {
    createCanvas: (width, height) => ({
      width,
      height,
      getContext: () => context,
      captureStream: () =>
        ({
          getVideoTracks: () => [processedTrack],
          getTracks: () => [processedTrack],
        }) as unknown as MediaStream,
    }),
    now: () => 1000,
  };
  const compositor = createFaceCompositor({
    environment,
    getSource: () => ({ source: {} as CanvasImageSource, width: 640, height: 480 }),
  });
  return compositor.getHandle()!;
}

function harness(options: { withReplace?: boolean; bytes?: number[] } = {}) {
  const published: { track: MediaStreamTrack; options: unknown }[] = [];
  const unpublished: { track: MediaStreamTrack; stop?: boolean }[] = [];
  const snapshots: (readonly PublicationRecord[])[] = [];
  const replaced: { current: MediaStreamTrack; next: MediaStreamTrack }[] = [];
  const bytesQueue = [...(options.bytes ?? [])];
  let sid = 0;
  let clock = 1000;
  const participant: PublisherPort = {
    publishTrack: vi.fn(async (value, publishOptions) => {
      published.push({ track: value, options: publishOptions });
      return { trackSid: `TR_${++sid}` };
    }),
    unpublishTrack: vi.fn(async (value, stopOnUnpublish) => {
      unpublished.push({ track: value, stop: stopOnUnpublish });
    }),
    getOutboundBytes: vi.fn(async () => bytesQueue.shift() ?? null),
  };
  if (options.withReplace)
    participant.replaceTrack = vi.fn(async (current, next) => {
      replaced.push({ current, next });
    });
  const publisher = createTrackPublisher({
    participant,
    now: () => clock,
    onPublication: (records) => snapshots.push(records),
  });
  return {
    publisher,
    participant,
    published,
    unpublished,
    snapshots,
    replaced,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('createTrackPublisher', () => {
  it.each(['face', 'microphone'] as const)(
    'waits and compensates an in-flight %s publish before retirement',
    async (source) => {
      const base = harness();
      let resolve!: (value: { trackSid: string }) => void;
      vi.mocked(base.participant.publishTrack).mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const input = source === 'face' ? processedHandle() : track('audio');
      const publishing =
        source === 'face'
          ? base.publisher.publishFace(input, scope)
          : base.publisher.publishMicrophone(input as MediaStreamTrack, scope);
      const rejected = expect(publishing).rejects.toMatchObject({ code: 'RETIRED' });
      await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
      let completed = false;
      const retiring = base.publisher.unpublishAll().then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      resolve({ trackSid: 'late' });
      await rejected;
      await retiring;
      expect(base.participant.unpublishTrack).toHaveBeenCalledTimes(1);
      expect(base.publisher.getPublications()).toEqual([]);
      await expect(base.publisher.publishMicrophone(track('audio'), scope)).rejects.toMatchObject({
        code: 'RETIRED',
      });
    },
  );

  it('does not claim cleanup when compensating an in-flight publication fails', async () => {
    const base = harness();
    let resolve!: (value: { trackSid: string }) => void;
    vi.mocked(base.participant.publishTrack).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.mocked(base.participant.unpublishTrack).mockRejectedValue(new Error('fixture SDK failure'));
    const publishing = base.publisher.publishMicrophone(track('audio'), scope);
    const failed = expect(publishing).rejects.toThrow('LOCAL_RETIREMENT_UNCONFIRMED');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    const retiring = base.publisher.unpublishAll();
    const cleanupFailed = expect(retiring).rejects.toThrow('LOCAL_RETIREMENT_UNCONFIRMED');
    resolve({ trackSid: 'late' });
    await failed;
    await cleanupFailed;
  });
  it('publishes the processed face with the 100kbps target and no simulcast', async () => {
    const base = harness();
    const handle = processedHandle();

    const sid = await base.publisher.publishFace(handle, scope);

    expect(sid).toBe('TR_1');
    expect(base.published).toHaveLength(1);
    expect(base.published[0]!.track).toBe(handle.track);
    expect(base.published[0]!.options).toEqual({
      source: 'camera',
      simulcast: false,
      videoEncoding: FACE_ENCODING,
    });
    expect(FACE_ENCODING.maxBitrate).toBe(100_000);
    expect(FACE_ENCODING.maxFramerate).toBe(10);
  });

  it('rejects a raw camera track and any non processed handle', async () => {
    const base = harness();

    await expect(base.publisher.publishFace(track('video'), scope)).rejects.toBeInstanceOf(
      PublishRejectedError,
    );
    await expect(
      base.publisher.publishFace({ track: track('video') }, scope),
    ).rejects.toMatchObject({ code: 'RAW_TRACK_REJECTED' });
    await expect(base.publisher.publishFace(null, scope)).rejects.toMatchObject({
      code: 'RAW_TRACK_REJECTED',
    });
    expect(base.published).toHaveLength(0);
  });

  it('rejects a screen share or any video track on the microphone path', async () => {
    const base = harness();

    await expect(base.publisher.publishMicrophone(track('video'), scope)).rejects.toMatchObject({
      code: 'SCREEN_SHARE_REJECTED',
    });
    expect(base.published).toHaveLength(0);
  });

  it('publishes exactly one face and one microphone publication', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope);
    await base.publisher.publishMicrophone(track('audio'), scope);

    const records = base.publisher.getPublications();
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.source).sort()).toEqual(['microphone', 'processed-face']);
  });

  it('never reports a publication as approved from the SDK success alone', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope);

    expect(base.publisher.getPublications()[0]!.serverConfirmed).toBe(false);
  });

  it('marks the publication approved only from a matching binding scope and sid', async () => {
    const base = harness();
    const sid = await base.publisher.publishFace(processedHandle(), scope);

    base.publisher.confirmFromBindings({ ...scope, receiverGeneration: 2 }, [sid]);
    expect(base.publisher.getPublications()[0]!.serverConfirmed).toBe(false);

    base.publisher.confirmFromBindings(scope, ['TR_other']);
    expect(base.publisher.getPublications()[0]!.serverConfirmed).toBe(false);

    base.publisher.confirmFromBindings(scope, [sid]);
    expect(base.publisher.getPublications()[0]!.serverConfirmed).toBe(true);
  });

  it('stops only the microphone send and keeps the face publication', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope);
    const microphone = track('audio');
    await base.publisher.publishMicrophone(microphone, scope);

    await base.publisher.stopMicrophone();

    expect(base.unpublished).toHaveLength(1);
    expect(base.unpublished[0]!.track).toBe(microphone);
    // 게시 해제가 원본 장치 track을 stop하지 않는다.
    expect(base.unpublished[0]!.stop).toBe(false);
    const records = base.publisher.getPublications();
    expect(records).toHaveLength(1);
    expect(records[0]!.source).toBe('processed-face');
  });

  it('is a no-op when the microphone was never published', async () => {
    const base = harness();
    await base.publisher.stopMicrophone();
    expect(base.unpublished).toHaveLength(0);
  });

  it('cleans the previous publication before a new sid publish and waits for the binding', async () => {
    const base = harness();
    const first = processedHandle();
    const firstSid = await base.publisher.publishFace(first, scope);
    base.publisher.confirmFromBindings(scope, [firstSid]);
    expect(base.publisher.getPublications()[0]!.serverConfirmed).toBe(true);

    const second = processedHandle();
    const secondSid = await base.publisher.publishFace(second, scope);

    expect(secondSid).not.toBe(firstSid);
    expect(base.unpublished[0]!.track).toBe(first.track);
    expect(base.unpublished[0]!.stop).toBe(false);
    // 재게시 뒤에는 다시 미승인 상태에서 B 대조를 기다린다.
    expect(base.publisher.getPublications()[0]!.serverConfirmed).toBe(false);
  });

  it('keeps the same publication and permission when only the source is replaced', async () => {
    const base = harness({ withReplace: true });
    const handle = processedHandle();
    const sid = await base.publisher.publishFace(handle, scope);
    base.publisher.confirmFromBindings(scope, [sid]);

    const next = track('video');
    const result = await base.publisher.replaceFaceSource(next);

    expect(result).toBe('replaced');
    expect(base.replaced).toEqual([{ current: handle.track, next }]);
    // 새 게시 사건 없이 같은 SID와 기존 승인이 유지된다.
    expect(base.published).toHaveLength(1);
    expect(base.publisher.getPublications()[0]).toMatchObject({
      trackSid: sid,
      serverConfirmed: true,
    });
  });

  it('reports unsupported instead of republishing when the SDK has no replaceTrack', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope);

    expect(await base.publisher.replaceFaceSource(track('video'))).toBe('unsupported');
    expect(base.published).toHaveLength(1);
  });

  it('applies the low preset encoding without touching the source rules', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope, 'low');

    expect(base.published[0]!.options).toEqual({
      source: 'camera',
      simulcast: false,
      videoEncoding: LOW_FACE_ENCODING,
    });
    expect(LOW_FACE_ENCODING.maxBitrate).toBeLessThan(FACE_ENCODING.maxBitrate);
  });

  it('separates the configured target from the measured bitrate', async () => {
    const base = harness({ bytes: [10_000, 35_000] });
    await base.publisher.publishFace(processedHandle(), scope);

    const first = await base.publisher.measureFaceBitrate();
    expect(first).toEqual({ measuredBps: null, configuredBps: 100_000 });

    base.advance(1000);
    const second = await base.publisher.measureFaceBitrate();
    expect(second.configuredBps).toBe(100_000);
    // 25,000 바이트 / 1초 = 200,000 bps. 설정 목표와 다른 실측값이다.
    expect(second.measuredBps).toBe(200_000);
  });

  it('returns a null measurement instead of guessing when stats are unavailable', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope);

    expect(await base.publisher.measureFaceBitrate()).toEqual({
      measuredBps: null,
      configuredBps: 100_000,
    });
  });

  it('clears every publication on a generation retire', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope);
    await base.publisher.publishMicrophone(track('audio'), scope);

    await base.publisher.unpublishAll();

    expect(base.publisher.getPublications()).toHaveLength(0);
    expect(base.unpublished).toHaveLength(2);
    expect(base.unpublished.every((entry) => entry.stop === false)).toBe(true);
  });

  it('publishes the publication snapshot on every change', async () => {
    const base = harness();
    await base.publisher.publishFace(processedHandle(), scope);
    await base.publisher.publishMicrophone(track('audio'), scope);
    await base.publisher.stopMicrophone();

    expect(base.snapshots.map((records) => records.length)).toEqual([1, 2, 1]);
  });
});
