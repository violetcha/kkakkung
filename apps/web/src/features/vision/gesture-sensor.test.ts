import { describe, expect, it } from 'vitest';

import { gestureCases } from '../../../../../tests/contracts/shared/fixtures';
import {
  combineHands,
  GESTURE_CATEGORY_MAP,
  GESTURE_MIN_SCORE,
  hasClosedFist,
  isClosedFist,
  NONE_GESTURE,
  pickHandGesture,
  readGestureSensor,
} from './gesture-sensor';
import { isSampleFresh, type NormalizedLandmark } from './sensor-types';

const category = (name: string, score: number) => ({ categoryName: name, score, index: -1 });
const NAMES: Record<string, string> = { palm: 'Open_Palm', victory: 'Victory' };

function fistHand(openTip?: 8 | 12 | 16 | 20): NormalizedLandmark[] {
  const hand = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [pip, tip] of [
    [6, 8],
    [10, 12],
    [14, 16],
    [18, 20],
  ] as const) {
    hand[pip] = { x: 0.4, y: 0, z: 0 };
    hand[tip] = { x: tip === openTip ? 0.6 : 0.2, y: 0, z: 0 };
  }
  return hand;
}

describe('readGestureSensor', () => {
  it('reports none when the two hands show different valid gestures', () => {
    const outcome = readGestureSensor({
      gestures: [[category('Open_Palm', 0.95)], [category('Victory', 0.96)]],
    });

    expect(outcome).toEqual({ status: 'valid', data: NONE_GESTURE });
  });

  it('picks the single highest score when both hands show the same gesture', () => {
    const outcome = readGestureSensor({
      gestures: [[category('Open_Palm', 0.95)], [category('Open_Palm', 0.96)]],
    });

    expect(outcome).toEqual({ status: 'valid', data: { kind: 'palm', score: 0.96 } });
  });

  it('matches the shared contract gesture fixtures', () => {
    for (const shared of gestureCases) {
      const gestures = shared.observed.map((name, index) => [
        category(NAMES[name]!, shared.scores[index]!),
      ]);
      const outcome = readGestureSensor({ gestures });

      expect(outcome.status).toBe('valid');
      if (outcome.status !== 'valid') throw new Error('expected a valid gesture');
      expect(outcome.data.kind).toBe(shared.expectedKind);
      if ('expectedScore' in shared) expect(outcome.data.score).toBe(shared.expectedScore);
    }
  });

  it('ignores categories below the score threshold and unknown category names', () => {
    expect(pickHandGesture([category('Open_Palm', GESTURE_MIN_SCORE - 0.01)])).toBeNull();
    expect(pickHandGesture([category('Thumb_Up', 0.99)])).toBeNull();
    expect(pickHandGesture([category('Open_Palm', Number.NaN)])).toBeNull();
    expect(pickHandGesture([category('Open_Palm', GESTURE_MIN_SCORE)])).toEqual({
      kind: 'palm',
      score: GESTURE_MIN_SCORE,
    });
  });

  it('returns a valid none when the model ran but saw no hand', () => {
    expect(readGestureSensor({ gestures: [] })).toEqual({ status: 'valid', data: NONE_GESTURE });
    expect(readGestureSensor({ gestures: [[]] })).toEqual({ status: 'valid', data: NONE_GESTURE });
  });

  it('reports missing only when the model produced no result at all', () => {
    expect(readGestureSensor(null)).toEqual({ status: 'missing', data: null });
    expect(readGestureSensor(undefined)).toEqual({ status: 'missing', data: null });
  });

  it('never leaks the per hand candidate array', () => {
    const outcome = readGestureSensor({
      gestures: [[category('Open_Palm', 0.9), category('Victory', 0.7)]],
    });
    if (outcome.status !== 'valid') throw new Error('expected a valid gesture');

    expect(Object.keys(outcome.data).sort()).toEqual(['kind', 'score']);
  });

  it('maps only the two approved SDK category names', () => {
    expect(Object.keys(GESTURE_CATEGORY_MAP).sort()).toEqual(['Open_Palm', 'Victory']);
  });
});

describe('combineHands', () => {
  it('returns none for no hands', () => {
    expect(combineHands([])).toEqual(NONE_GESTURE);
    expect(combineHands([null, null])).toEqual(NONE_GESTURE);
  });
});

describe('closed fist geometry', () => {
  it('requires every fingertip to be closer to the wrist than its PIP joint', () => {
    expect(isClosedFist(fistHand())).toBe(true);
    expect(isClosedFist(fistHand(12))).toBe(false);
  });

  it('rejects incomplete or non-finite hands and accepts either hand', () => {
    expect(isClosedFist(fistHand().slice(0, 20))).toBe(false);
    const invalid = fistHand();
    invalid[8] = { x: Number.NaN, y: 0, z: 0 };
    expect(isClosedFist(invalid)).toBe(false);
    expect(hasClosedFist([fistHand(8), fistHand()])).toBe(true);
    expect(hasClosedFist([fistHand(8)])).toBe(false);
  });
});

describe('gesture freshness', () => {
  it('uses the 400ms gesture budget instead of the 300ms one', () => {
    const sample = {
      frameId: 3,
      sampledAtMs: 1000,
      receivedAtMs: 1010,
      status: 'valid',
      data: { kind: 'palm', score: 0.9 },
    } as const;

    expect(isSampleFresh(sample, 'gesture', 1400)).toBe(true);
    expect(isSampleFresh(sample, 'gesture', 1401)).toBe(false);
    expect(isSampleFresh(sample, 'face', 1400)).toBe(false);
  });
});
