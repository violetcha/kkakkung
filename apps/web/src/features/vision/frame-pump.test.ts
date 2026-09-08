import { describe, expect, it, vi } from 'vitest';

import {
  createFramePump,
  createModelSelector,
  MODEL_TARGET_INTERVAL_MS,
  type FrameSource,
} from './frame-pump';
import type { VisionModelKind } from './worker-protocol';

function bitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

type Harness = {
  source: FrameSource;
  tick(): Promise<void>;
  advance(ms: number): void;
  cancels: number;
  scheduled: number;
};

function source(grab: () => Promise<ImageBitmap | null>): Harness {
  let clock = 1000;
  let pending: (() => void) | null = null;
  const state = { cancels: 0, scheduled: 0 };
  const port: FrameSource = {
    schedule: (callback) => {
      pending = callback;
      state.scheduled += 1;
      return () => {
        state.cancels += 1;
        pending = null;
      };
    },
    grab,
    now: () => clock,
  };
  return {
    source: port,
    async tick() {
      const callback = pending;
      pending = null;
      callback?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    advance: (ms) => {
      clock += ms;
    },
    get cancels() {
      return state.cancels;
    },
    get scheduled() {
      return state.scheduled;
    },
  };
}

describe('createFramePump', () => {
  it('increments the frame id only for frames the scheduler accepted', async () => {
    const base = source(async () => bitmap());
    const submit = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const pump = createFramePump({
      source: base.source,
      submit,
      selectModels: () => ['face'],
    });

    pump.start();
    await base.tick();
    expect(pump.frameId).toBe(1);

    await base.tick();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(pump.frameId).toBe(1);
  });

  it('passes the observation time it read before grabbing the frame', async () => {
    const base = source(async () => bitmap());
    const submit = vi.fn(() => true);
    const pump = createFramePump({ source: base.source, submit, selectModels: () => ['pose'] });

    pump.start();
    base.advance(250);
    await base.tick();

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ frameId: 1, sampledAtMs: 1250, models: ['pose'] }),
    );
  });

  it('sends nothing when no model is due', async () => {
    const base = source(async () => bitmap());
    const submit = vi.fn(() => true);
    const pump = createFramePump({ source: base.source, submit, selectModels: () => [] });

    pump.start();
    await base.tick();

    expect(submit).not.toHaveBeenCalled();
    expect(pump.frameId).toBe(0);
  });

  it('closes a frame that arrives after stop', async () => {
    let release!: (value: ImageBitmap) => void;
    const pending = new Promise<ImageBitmap>((resolve) => {
      release = resolve;
    });
    const base = source(() => pending);
    const submit = vi.fn(() => true);
    const pump = createFramePump({ source: base.source, submit, selectModels: () => ['face'] });

    pump.start();
    await base.tick();
    pump.stop();
    const late = bitmap();
    release(late);
    await Promise.resolve();
    await Promise.resolve();

    expect(submit).not.toHaveBeenCalled();
    expect(late.close).toHaveBeenCalledTimes(1);
  });

  it('reports a grab failure without stopping the schedule', async () => {
    const base = source(async () => {
      throw new Error('decode failed');
    });
    const onError = vi.fn();
    const pump = createFramePump({
      source: base.source,
      submit: vi.fn(() => true),
      selectModels: () => ['face'],
      onError,
    });

    pump.start();
    await base.tick();

    expect(onError).toHaveBeenCalledWith('FRAME_GRAB_FAILED');
    expect(pump.running).toBe(true);
  });

  it('cancels the pending schedule on stop and is idempotent', async () => {
    const base = source(async () => bitmap());
    const pump = createFramePump({
      source: base.source,
      submit: vi.fn(() => true),
      selectModels: () => ['face'],
    });

    pump.start();
    pump.start();
    pump.stop();
    pump.stop();

    expect(base.cancels).toBe(1);
    expect(pump.running).toBe(false);
  });
});

describe('createModelSelector', () => {
  it('spreads the models by their own target interval instead of running all every frame', () => {
    const selector = createModelSelector();

    expect(selector.select(0)).toEqual(['face', 'pose', 'gesture']);
    selector.markSent(0, ['face', 'pose', 'gesture']);
    expect(selector.select(10)).toEqual([]);

    const faceDue = MODEL_TARGET_INTERVAL_MS.face;
    expect(selector.select(faceDue)).toEqual(['face', 'pose']);
    expect(selector.select(MODEL_TARGET_INTERVAL_MS.gesture)).toEqual(['face', 'pose', 'gesture']);
  });

  it('stops selecting a model that the context disabled', () => {
    const selector = createModelSelector();
    selector.setEnabled('pose', false);

    const due = selector.select(1000);
    expect(due).not.toContain('pose' as VisionModelKind);
    expect(due).toContain('face' as VisionModelKind);
  });

  it('targets 15fps for face and pose and 10fps for gesture', () => {
    expect(MODEL_TARGET_INTERVAL_MS.face).toBeCloseTo(1000 / 15, 6);
    expect(MODEL_TARGET_INTERVAL_MS.pose).toBeCloseTo(1000 / 15, 6);
    expect(MODEL_TARGET_INTERVAL_MS.gesture).toBeCloseTo(1000 / 10, 6);
  });
});
