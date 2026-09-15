import { describe, expect, it } from 'vitest';

import { FACE_MAX_YAW_RAD } from '../vision/face-sensor';
import {
  BACKLIT_FACE_MAX_LUMA,
  CONDITION_MIN_VISIBLE_MS,
  CONDITION_REPEAT_SUPPRESS_MS,
  CONDITION_SHOW_AFTER_MS,
  classifyFaceCondition,
  createFaceConditionNotifier,
  FACE_CONDITION_GUIDANCE,
  FACE_CONDITION_TUNING_VERSION,
  faceConditionGuidance,
  GLARE_EYE_RATIO,
  LUMINANCE_MIN_SAMPLES,
  OCCLUSION_MISSING_RATIO,
  type FaceCondition,
  type FaceConditionInput,
  type LuminanceProfile,
} from './face-condition';

function luminance(value: Partial<LuminanceProfile> = {}): LuminanceProfile {
  return {
    faceMean: 130,
    surroundMean: 120,
    eyeSaturatedRatio: 0,
    sampleCount: LUMINANCE_MIN_SAMPLES,
    ...value,
  };
}

function input(value: Partial<FaceConditionInput> = {}): FaceConditionInput {
  return {
    faceMissing: false,
    yawRad: 0,
    ovalMissingRatio: 0,
    luminance: luminance(),
    ...value,
  };
}

describe('classifyFaceCondition', () => {
  it('reports ok when every signal is within range', () => {
    expect(classifyFaceCondition(input())).toBe('ok');
  });

  it('separates the four conditions', () => {
    const turned = classifyFaceCondition(input({ yawRad: FACE_MAX_YAW_RAD + 0.01 }));
    const glare = classifyFaceCondition(
      input({ luminance: luminance({ eyeSaturatedRatio: GLARE_EYE_RATIO }) }),
    );
    const backlit = classifyFaceCondition(
      input({ luminance: luminance({ faceMean: 40, surroundMean: 200 }) }),
    );
    const occluded = classifyFaceCondition(
      input({ ovalMissingRatio: OCCLUSION_MISSING_RATIO + 0.01 }),
    );

    expect([turned, glare, backlit, occluded]).toEqual([
      'turned-away',
      'glare',
      'backlit',
      'occluded',
    ]);
    // 네 조건이 서로 다른 문구를 가져야 안내로 구분된다.
    const messages = [turned, glare, backlit, occluded].map(faceConditionGuidance);
    expect(new Set(messages).size).toBe(4);
    expect(messages.every((message) => message !== null && message.length > 0)).toBe(true);
  });

  it('treats a large yaw as turned-away before any luminance signal', () => {
    const condition = classifyFaceCondition(
      input({
        yawRad: -(FACE_MAX_YAW_RAD + 0.2),
        luminance: luminance({ eyeSaturatedRatio: 1, faceMean: 10, surroundMean: 250 }),
      }),
    );

    expect(condition).toBe('turned-away');
  });

  it('prefers backlit over occluded because the actionable fix differs', () => {
    const condition = classifyFaceCondition(
      input({
        ovalMissingRatio: 1,
        luminance: luminance({ faceMean: 30, surroundMean: 220 }),
      }),
    );

    expect(condition).toBe('backlit');
  });

  it('does not call a merely dark face backlit without a brighter surround', () => {
    const condition = classifyFaceCondition(
      input({ luminance: luminance({ faceMean: BACKLIT_FACE_MAX_LUMA - 10, surroundMean: 60 }) }),
    );

    expect(condition).toBe('ok');
  });

  it('ignores luminance drawn from too few pixels', () => {
    const condition = classifyFaceCondition(
      input({
        luminance: luminance({
          faceMean: 10,
          surroundMean: 250,
          eyeSaturatedRatio: 1,
          sampleCount: LUMINANCE_MIN_SAMPLES - 1,
        }),
      }),
    );

    expect(condition).toBe('ok');
  });

  it('stays unknown when the face is lost and nothing explains it', () => {
    expect(classifyFaceCondition(input({ faceMissing: true, yawRad: null, luminance: null }))).toBe(
      'unknown',
    );
    expect(faceConditionGuidance('unknown')).toBeNull();
  });

  it('never advertises the processed face as anonymisation', () => {
    for (const message of Object.values(FACE_CONDITION_GUIDANCE)) {
      if (message === null) continue;
      expect(message).not.toMatch(/익명/);
    }
  });

  it('records the tuning version so measurement can move the thresholds', () => {
    expect(FACE_CONDITION_TUNING_VERSION).toBe('D-face-condition-1');
  });
});

describe('createFaceConditionNotifier', () => {
  const show = (
    notifier: ReturnType<typeof createFaceConditionNotifier>,
    condition: FaceCondition,
    atMs: number,
  ) => notifier.observe(condition, atMs);

  it('waits for the condition to persist before showing guidance', () => {
    const notifier = createFaceConditionNotifier();

    expect(show(notifier, 'glare', 0)).toBeNull();
    expect(show(notifier, 'glare', CONDITION_SHOW_AFTER_MS - 1)).toBeNull();
    expect(show(notifier, 'glare', CONDITION_SHOW_AFTER_MS)?.isNew).toBe(true);
  });

  it('does not show guidance for a flicker that resets the candidate', () => {
    const notifier = createFaceConditionNotifier();
    show(notifier, 'glare', 0);
    show(notifier, 'ok', CONDITION_SHOW_AFTER_MS - 1);

    expect(show(notifier, 'glare', CONDITION_SHOW_AFTER_MS)).toBeNull();
  });

  it('marks a continuing notice as not new', () => {
    const notifier = createFaceConditionNotifier();
    show(notifier, 'backlit', 0);
    const first = show(notifier, 'backlit', CONDITION_SHOW_AFTER_MS);
    const second = show(notifier, 'backlit', CONDITION_SHOW_AFTER_MS + 100);

    expect(first?.isNew).toBe(true);
    expect(second).toEqual({ ...first, isNew: false });
  });

  it('keeps a notice visible for the minimum window after the condition clears', () => {
    const notifier = createFaceConditionNotifier();
    show(notifier, 'occluded', 0);
    const shownAt = CONDITION_SHOW_AFTER_MS;
    show(notifier, 'occluded', shownAt);

    expect(show(notifier, 'ok', shownAt + CONDITION_MIN_VISIBLE_MS - 1)?.condition).toBe(
      'occluded',
    );
    expect(show(notifier, 'ok', shownAt + CONDITION_MIN_VISIBLE_MS)).toBeNull();
  });

  it('suppresses the same condition from reappearing too soon', () => {
    const notifier = createFaceConditionNotifier();
    show(notifier, 'glare', 0);
    const shownAt = CONDITION_SHOW_AFTER_MS;
    show(notifier, 'glare', shownAt);
    const clearedAt = shownAt + CONDITION_MIN_VISIBLE_MS;
    show(notifier, 'ok', clearedAt);

    // 억제 창 안에서는 조건이 다시 이어져도 띄우지 않는다.
    show(notifier, 'glare', clearedAt + 1);
    expect(show(notifier, 'glare', clearedAt + CONDITION_SHOW_AFTER_MS + 1)).toBeNull();

    // 조건이 억제 창 내내 이어졌으므로 창이 풀리는 순간 다시 띄운다. 추가 대기는 없다.
    const afterWindow = clearedAt + CONDITION_REPEAT_SUPPRESS_MS;
    expect(show(notifier, 'glare', afterWindow)?.isNew).toBe(true);
  });

  it('does not suppress a different condition', () => {
    const notifier = createFaceConditionNotifier();
    show(notifier, 'glare', 0);
    const shownAt = CONDITION_SHOW_AFTER_MS;
    show(notifier, 'glare', shownAt);
    const clearedAt = shownAt + CONDITION_MIN_VISIBLE_MS;
    show(notifier, 'ok', clearedAt);

    show(notifier, 'backlit', clearedAt + 1);
    expect(show(notifier, 'backlit', clearedAt + 1 + CONDITION_SHOW_AFTER_MS)?.condition).toBe(
      'backlit',
    );
  });

  it('forgets everything on reset so a new generation starts clean', () => {
    const notifier = createFaceConditionNotifier();
    show(notifier, 'glare', 0);
    show(notifier, 'glare', CONDITION_SHOW_AFTER_MS);
    notifier.reset();

    show(notifier, 'glare', 0);
    expect(show(notifier, 'glare', CONDITION_SHOW_AFTER_MS)?.isNew).toBe(true);
  });
});
