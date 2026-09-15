import { describe, expect, it } from 'vitest';

import { FACE_KEY_POINTS } from '../vision/face-sensor';
import type { NormalizedLandmark } from '../vision/sensor-types';
import { classifyFaceCondition, ovalMissingRatio } from './face-condition';
import { buildFaceMask, FACE_OVAL_INDICES } from './face-mask';
import {
  createLuminanceSampler,
  FACE_SAMPLE_SIZE,
  FRAME_SAMPLE_SIZE,
  LUMINANCE_SAMPLE_INTERVAL_MS,
  type LuminanceCanvas,
  type LuminanceContext,
} from './face-luminance';

const LANDMARK_COUNT = 478;

/** 얼굴 외곽을 중앙의 원으로 놓은 합성 landmarks. 실제 추론 결과가 아니다. */
function syntheticLandmarks(options: { dropOval?: number } = {}): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  const drop = options.dropOval ?? 0;
  FACE_OVAL_INDICES.forEach((index, order) => {
    if (order < drop) {
      landmarks[index] = { x: Number.NaN, y: Number.NaN, z: 0 };
      return;
    }
    const angle = (order / FACE_OVAL_INDICES.length) * Math.PI * 2;
    landmarks[index] = { x: 0.5 + Math.cos(angle) * 0.2, y: 0.5 + Math.sin(angle) * 0.2, z: 0 };
  });
  landmarks[FACE_KEY_POINTS.leftEyeOuter] = { x: 0.58, y: 0.45, z: 0 };
  landmarks[FACE_KEY_POINTS.rightEyeOuter] = { x: 0.42, y: 0.45, z: 0 };
  return landmarks;
}

type Scene = Readonly<{
  /** 원본 전체를 축소한 표본의 픽셀 휘도. */
  frame(x: number, y: number): number;
  /** 얼굴 crop 을 축소한 표본의 픽셀 휘도. */
  face(x: number, y: number): number;
}>;

function sampler(scene: Scene, options: { source?: boolean } = {}) {
  const drawn: string[] = [];
  const makeContext = (size: number, read: (x: number, y: number) => number): LuminanceContext => ({
    drawImage: () => drawn.push(`draw:${size}`),
    getImageData: (_x, _y, width, height) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4;
          const luma = read(x, y);
          data[offset] = luma;
          data[offset + 1] = luma;
          data[offset + 2] = luma;
          data[offset + 3] = 255;
        }
      }
      return { data };
    },
  });
  const createCanvas = (width: number): LuminanceCanvas => ({
    getContext: () =>
      width === FRAME_SAMPLE_SIZE
        ? makeContext(FRAME_SAMPLE_SIZE, scene.frame)
        : makeContext(FACE_SAMPLE_SIZE, scene.face),
  });
  return {
    drawn,
    instance: createLuminanceSampler({
      createCanvas,
      getSource: () =>
        options.source === false
          ? null
          : { source: {} as CanvasImageSource, width: 640, height: 480 },
    }),
  };
}

function maskOf(landmarks: readonly NormalizedLandmark[]) {
  const mask = buildFaceMask(landmarks);
  if (!mask) throw new Error('test landmarks must produce a mask');
  return mask;
}

describe('createLuminanceSampler', () => {
  it('reports a dark face against a bright surround', () => {
    const landmarks = syntheticLandmarks();
    const { instance } = sampler({ frame: () => 220, face: () => 30 });

    const profile = instance.sample(maskOf(landmarks), landmarks, 0);

    expect(profile).not.toBeNull();
    expect(profile!.faceMean).toBeCloseTo(30, 0);
    expect(profile!.surroundMean).toBeCloseTo(220, 0);
    expect(profile!.sampleCount).toBeGreaterThan(0);
    expect(classifyFaceCondition({ ...base(landmarks), luminance: profile })).toBe('backlit');
  });

  it('counts saturated pixels only inside the eye region', () => {
    const landmarks = syntheticLandmarks();
    const mask = maskOf(landmarks);
    // 눈 부근만 포화시키고 나머지 얼굴은 중간 밝기로 둔다.
    const eyeY = FACE_SAMPLE_SIZE * 0.45;
    const { instance } = sampler({
      frame: () => 120,
      face: (_x, y) => (Math.abs(y - eyeY) <= 4 ? 255 : 120),
    });

    const profile = instance.sample(mask, landmarks, 0);

    expect(profile!.eyeSaturatedRatio).toBeGreaterThan(0);
    expect(profile!.eyeSaturatedRatio).toBeLessThan(1);
    expect(classifyFaceCondition({ ...base(landmarks), luminance: profile })).toBe('glare');
  });

  it('claims no glare when the eye landmarks fall outside the crop', () => {
    const landmarks = syntheticLandmarks();
    landmarks[FACE_KEY_POINTS.leftEyeOuter] = { x: 5, y: 5, z: 0 };
    landmarks[FACE_KEY_POINTS.rightEyeOuter] = { x: -5, y: -5, z: 0 };
    const { instance } = sampler({ frame: () => 120, face: () => 255 });

    const profile = instance.sample(maskOf(landmarks), landmarks, 0);

    expect(profile!.eyeSaturatedRatio).toBe(0);
  });

  it('holds the sampling interval so the frame loop is not charged every frame', () => {
    const landmarks = syntheticLandmarks();
    const mask = maskOf(landmarks);
    const { instance, drawn } = sampler({ frame: () => 120, face: () => 120 });

    expect(instance.sample(mask, landmarks, 0)).not.toBeNull();
    const afterFirst = drawn.length;
    expect(instance.sample(mask, landmarks, LUMINANCE_SAMPLE_INTERVAL_MS - 1)).toBeNull();
    expect(drawn.length).toBe(afterFirst);
    expect(instance.sample(mask, landmarks, LUMINANCE_SAMPLE_INTERVAL_MS)).not.toBeNull();
    expect(drawn.length).toBeGreaterThan(afterFirst);
  });

  it('returns nothing without a source frame', () => {
    const landmarks = syntheticLandmarks();
    const { instance } = sampler({ frame: () => 120, face: () => 120 }, { source: false });

    expect(instance.sample(maskOf(landmarks), landmarks, 0)).toBeNull();
  });

  it('samples again after reset', () => {
    const landmarks = syntheticLandmarks();
    const mask = maskOf(landmarks);
    const { instance } = sampler({ frame: () => 120, face: () => 120 });
    instance.sample(mask, landmarks, 0);
    instance.reset();

    expect(instance.sample(mask, landmarks, 1)).not.toBeNull();
  });
});

describe('ovalMissingRatio', () => {
  it('is zero for a complete oval', () => {
    expect(ovalMissingRatio(syntheticLandmarks())).toBe(0);
  });

  it('grows with the number of unreadable oval points', () => {
    const dropped = ovalMissingRatio(syntheticLandmarks({ dropOval: 9 }));

    expect(dropped).toBeCloseTo(9 / FACE_OVAL_INDICES.length, 6);
    expect(
      classifyFaceCondition({ ...base(syntheticLandmarks()), ovalMissingRatio: dropped }),
    ).toBe('occluded');
  });
});

function base(landmarks: readonly NormalizedLandmark[]) {
  return {
    faceMissing: false,
    yawRad: 0,
    ovalMissingRatio: ovalMissingRatio(landmarks),
    luminance: null,
  };
}
