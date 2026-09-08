import { describe, expect, it, vi } from 'vitest';

import type { SensorSnapshot } from './sensor-types';
import { createWorkerScheduler, type WorkerPort } from './worker-scheduler';
import type { FrameOutcomes, WorkerRequest, WorkerResponse } from './worker-protocol';

const GENERATION = 7;

function bitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

function harness(generation = GENERATION) {
  const posted: WorkerRequest[] = [];
  const transfers: Transferable[][] = [];
  const snapshots: SensorSnapshot[] = [];
  const errors: string[] = [];
  const terminate = vi.fn();
  let clock = 1000;
  const worker: WorkerPort = {
    postMessage: (message, transfer) => {
      posted.push(message);
      if (transfer) transfers.push(transfer);
    },
    terminate,
    set onmessage(_handler: ((event: { data: unknown }) => void) | null) {},
    set onerror(_handler: ((event: unknown) => void) | null) {},
  };
  const scheduler = createWorkerScheduler(
    {
      worker,
      now: () => clock,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: (code) => errors.push(code),
    },
    generation,
  );
  return {
    scheduler,
    posted,
    transfers,
    snapshots,
    errors,
    terminate,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

const face = (): FrameOutcomes => ({
  face: { status: 'valid', data: { landmarks: [], yawRad: 0, quality: 'valid' } },
});

const result = (frameId: number, sampledAtMs: number, outcomes: FrameOutcomes): WorkerResponse => ({
  type: 'result',
  runtimeGeneration: GENERATION,
  frameId,
  sampledAtMs,
  outcomes,
});

describe('createWorkerScheduler', () => {
  it('keeps one frame in flight and drops the extras without a queue', () => {
    const base = harness();
    const first = bitmap();
    const second = bitmap();
    const third = bitmap();

    expect(
      base.scheduler.submit({ frameId: 1, sampledAtMs: 1000, bitmap: first, models: ['face'] }),
    ).toBe(true);
    expect(
      base.scheduler.submit({ frameId: 2, sampledAtMs: 1030, bitmap: second, models: ['face'] }),
    ).toBe(false);
    expect(
      base.scheduler.submit({ frameId: 3, sampledAtMs: 1060, bitmap: third, models: ['face'] }),
    ).toBe(false);

    expect(base.posted).toHaveLength(1);
    expect(base.scheduler.inFlight).toBe(true);
    expect(base.scheduler.droppedFrames).toBe(2);
    // 버린 프레임의 bitmap은 즉시 닫는다.
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(third.close).toHaveBeenCalledTimes(1);
    expect(first.close).not.toHaveBeenCalled();
    expect(base.transfers[0]).toEqual([first]);
  });

  it('accepts the next frame once the result arrives', () => {
    const base = harness();
    base.scheduler.submit({ frameId: 1, sampledAtMs: 1000, bitmap: bitmap(), models: ['face'] });
    base.scheduler.handleMessage(result(1, 1000, face()));

    expect(base.scheduler.inFlight).toBe(false);
    expect(
      base.scheduler.submit({ frameId: 2, sampledAtMs: 1100, bitmap: bitmap(), models: ['face'] }),
    ).toBe(true);
  });

  it('ignores a result from an older runtime generation', () => {
    const base = harness();
    base.scheduler.submit({ frameId: 1, sampledAtMs: 1000, bitmap: bitmap(), models: ['face'] });

    base.scheduler.handleMessage({ ...result(1, 1000, face()), runtimeGeneration: GENERATION - 1 });

    expect(base.snapshots).toHaveLength(0);
    expect(base.scheduler.getSnapshot().face).toBeNull();
  });

  it('reports a worker exception once and applies no sensor value', () => {
    const base = harness();
    base.scheduler.submit({ frameId: 1, sampledAtMs: 1000, bitmap: bitmap(), models: ['face'] });

    base.scheduler.handleMessage({
      type: 'error',
      runtimeGeneration: GENERATION,
      frameId: 1,
      code: 'INFERENCE_FAILED',
    });
    base.scheduler.handleWorkerError();

    expect(base.errors).toEqual(['INFERENCE_FAILED']);
    expect(base.snapshots).toHaveLength(0);
  });

  it('keeps the untouched sensors at their own frameId and sampledAtMs', () => {
    const base = harness();
    base.scheduler.submit({
      frameId: 1,
      sampledAtMs: 1000,
      bitmap: bitmap(),
      models: ['face', 'pose'],
    });
    base.scheduler.handleMessage(
      result(1, 1000, {
        ...face(),
        pose: { status: 'valid', data: { landmarks: [], quality: 'valid' } },
      }),
    );

    base.advance(600);
    base.scheduler.submit({ frameId: 2, sampledAtMs: 1600, bitmap: bitmap(), models: ['face'] });
    base.scheduler.handleMessage(result(2, 1600, face()));

    const latest = base.snapshots.at(-1)!;
    expect(latest.face).toMatchObject({ frameId: 2, sampledAtMs: 1600 });
    // pose는 이번에 실행하지 않았으므로 이전 관측 시각을 그대로 유지한다.
    expect(latest.pose).toMatchObject({ frameId: 1, sampledAtMs: 1000 });
    expect(latest.emittedAtMs).toBe(1600);
    expect(latest.gesture).toBeNull();
  });

  it('records a new missing sample instead of keeping the previous value', () => {
    const base = harness();
    base.scheduler.submit({ frameId: 1, sampledAtMs: 1000, bitmap: bitmap(), models: ['pose'] });
    base.scheduler.handleMessage(
      result(1, 1000, { pose: { status: 'valid', data: { landmarks: [], quality: 'valid' } } }),
    );
    base.advance(700);
    base.scheduler.submit({ frameId: 2, sampledAtMs: 1700, bitmap: bitmap(), models: ['pose'] });
    base.scheduler.handleMessage(result(2, 1700, { pose: { status: 'missing', data: null } }));

    expect(base.snapshots.at(-1)!.pose).toEqual({
      frameId: 2,
      sampledAtMs: 1700,
      receivedAtMs: 1700,
      status: 'missing',
      data: null,
    });
  });

  it('stamps every timestamp on the main clock the caller supplies', () => {
    const base = harness();
    base.advance(500);
    base.scheduler.submit({ frameId: 1, sampledAtMs: 1400, bitmap: bitmap(), models: ['face'] });
    base.advance(40);
    base.scheduler.handleMessage(result(1, 1400, face()));

    const snapshot = base.snapshots.at(-1)!;
    expect(snapshot.face).toMatchObject({ sampledAtMs: 1400, receivedAtMs: 1540 });
    expect(snapshot.emittedAtMs).toBe(1540);
    expect(snapshot.runtimeGeneration).toBe(GENERATION);
  });

  it('reports a protocol error for a message that is not a worker response', () => {
    const base = harness();
    base.scheduler.handleMessage({ hello: 'world' });
    expect(base.errors).toEqual(['PROTOCOL_ERROR']);
  });

  it('closes and terminates the worker on dispose and refuses later frames', () => {
    const base = harness();
    base.scheduler.dispose();
    const late = bitmap();

    expect(
      base.scheduler.submit({ frameId: 9, sampledAtMs: 2000, bitmap: late, models: ['face'] }),
    ).toBe(false);
    base.scheduler.handleMessage(result(9, 2000, face()));

    expect(base.posted.at(-1)).toEqual({ type: 'close' });
    expect(base.terminate).toHaveBeenCalledTimes(1);
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(base.snapshots).toHaveLength(0);
  });
});
