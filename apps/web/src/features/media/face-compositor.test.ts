import { describe, expect, it, vi } from 'vitest';

import type { FaceSensor } from '../vision/sensor-types';
import {
  assertProcessedFace,
  createFaceCompositor,
  isProcessedFaceHandle,
  type CompositorCanvas,
  type CompositorContext,
  type CompositorEnvironment,
} from './face-compositor';
import { FACE_OVAL_INDICES, PROCESSED_FACE_FPS, PROCESSED_FACE_SIZE } from './face-mask';

const maxOval = Math.max(...FACE_OVAL_INDICES);

function ovalFace(quality: FaceSensor['quality'] = 'valid'): FaceSensor {
  const landmarks = Array.from({ length: maxOval + 1 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  FACE_OVAL_INDICES.forEach((index, order) => {
    const angle = (order / FACE_OVAL_INDICES.length) * Math.PI * 2;
    landmarks[index] = { x: 0.5 + Math.cos(angle) * 0.12, y: 0.5 + Math.sin(angle) * 0.12, z: 0 };
  });
  return { landmarks, yawRad: 0, quality };
}

function harness(options: { withTrack?: boolean; withContext?: boolean } = {}) {
  const calls: string[] = [];
  const track = {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(function (this: { readyState: string }) {
      this.readyState = 'ended';
    }),
  };
  const context: CompositorContext = {
    fillStyle: '',
    filter: '',
    fillRect: (...args) => calls.push(`fillRect:${args.join(',')}`),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    closePath: () => calls.push('closePath'),
    clip: () => calls.push('clip'),
    drawImage: () => calls.push('drawImage'),
  };
  const captureStream = vi.fn(
    () =>
      ({
        getVideoTracks: () => (options.withTrack === false ? [] : [track]),
        getTracks: () => (options.withTrack === false ? [] : [track]),
      }) as unknown as MediaStream,
  );
  const canvas: CompositorCanvas = {
    width: PROCESSED_FACE_SIZE,
    height: PROCESSED_FACE_SIZE,
    getContext: () => (options.withContext === false ? null : context),
    captureStream,
  };
  const environment: CompositorEnvironment = {
    createCanvas: () => canvas,
    now: () => 1000,
  };
  return { environment, calls, track, captureStream, context };
}

const source = () => ({ source: {} as CanvasImageSource, width: 640, height: 480 });

describe('createFaceCompositor', () => {
  it('captures the stream from the canvas at the processed frame rate', () => {
    const base = harness();
    const compositor = createFaceCompositor({ environment: base.environment, getSource: source });

    expect(base.captureStream).toHaveBeenCalledWith(PROCESSED_FACE_FPS);
    const handle = compositor.getHandle()!;
    expect(handle.width).toBe(PROCESSED_FACE_SIZE);
    expect(handle.height).toBe(PROCESSED_FACE_SIZE);
    expect(handle.frameRate).toBe(PROCESSED_FACE_FPS);
  });

  it('fills the whole canvas black before drawing any face pixel', () => {
    const base = harness();
    const compositor = createFaceCompositor({ environment: base.environment, getSource: source });

    expect(compositor.draw(ovalFace())).toBe('masked');

    const fillIndex = base.calls.indexOf(
      `fillRect:0,0,${PROCESSED_FACE_SIZE},${PROCESSED_FACE_SIZE}`,
    );
    const drawIndex = base.calls.indexOf('drawImage');
    expect(fillIndex).toBe(0);
    expect(drawIndex).toBeGreaterThan(fillIndex);
    // 원본은 clip 안에서만 그린다.
    expect(base.calls.indexOf('clip')).toBeLessThan(drawIndex);
    expect(base.calls.indexOf('restore')).toBeGreaterThan(drawIndex);
  });

  it('draws only the safe black frame when the face is missing or uncertain', () => {
    const base = harness();
    const compositor = createFaceCompositor({ environment: base.environment, getSource: source });

    expect(compositor.draw(null)).toBe('safe');
    expect(compositor.draw(ovalFace('uncertain'))).toBe('safe');
    expect(base.calls).not.toContain('drawImage');
    expect(compositor.hasFirstSafeFrame).toBe(true);
  });

  it('falls back to the safe frame instead of the raw camera when there is no source', () => {
    const base = harness();
    const compositor = createFaceCompositor({
      environment: base.environment,
      getSource: () => null,
    });

    expect(compositor.draw(ovalFace())).toBe('safe');
    expect(base.calls).not.toContain('drawImage');
  });

  it('reports the first safe frame only after a draw', () => {
    const base = harness();
    const onFirstSafeFrame = vi.fn();
    const compositor = createFaceCompositor({
      environment: base.environment,
      getSource: source,
      onFirstSafeFrame,
    });

    expect(compositor.hasFirstSafeFrame).toBe(false);
    compositor.draw(null);
    expect(compositor.hasFirstSafeFrame).toBe(true);
    expect(onFirstSafeFrame).toHaveBeenCalled();
  });

  it('rejects a raw track that pretends to be a processed handle', () => {
    const base = harness();
    const compositor = createFaceCompositor({ environment: base.environment, getSource: source });
    const rawTrack = { kind: 'video', readyState: 'live' } as unknown as MediaStreamTrack;
    const fake = { track: rawTrack, width: 160, height: 160, frameRate: 10 };

    expect(isProcessedFaceHandle(fake)).toBe(false);
    expect(() => assertProcessedFace(fake)).toThrow(/RAW_TRACK_REJECTED/);
    expect(() => assertProcessedFace(rawTrack)).toThrow(/RAW_TRACK_REJECTED/);
    expect(() => assertProcessedFace(null)).toThrow(/RAW_TRACK_REJECTED/);
    // 실제 가공 handle만 통과한다.
    expect(assertProcessedFace(compositor.getHandle())).toBe(compositor.getHandle());
  });

  it('has no handle and stays unready when the canvas context fails', () => {
    const base = harness({ withContext: false });
    const compositor = createFaceCompositor({ environment: base.environment, getSource: source });

    expect(compositor.getHandle()).toBeNull();
    expect(compositor.isTrackLive).toBe(false);
    expect(compositor.draw(ovalFace())).toBe('safe');
    expect(compositor.hasFirstSafeFrame).toBe(false);
  });

  it('has no handle when the captured stream carries no video track', () => {
    const base = harness({ withTrack: false });
    const compositor = createFaceCompositor({ environment: base.environment, getSource: source });

    expect(compositor.getHandle()).toBeNull();
    expect(compositor.isTrackLive).toBe(false);
  });

  it('stops the processed track and drops the handle on dispose', () => {
    const base = harness();
    const compositor = createFaceCompositor({ environment: base.environment, getSource: source });
    compositor.draw(ovalFace());
    expect(compositor.isTrackLive).toBe(true);

    compositor.dispose();
    compositor.dispose();

    expect(base.track.stop).toHaveBeenCalledTimes(1);
    expect(compositor.getHandle()).toBeNull();
    expect(compositor.isTrackLive).toBe(false);
    expect(compositor.draw(ovalFace())).toBe('safe');
  });
});
