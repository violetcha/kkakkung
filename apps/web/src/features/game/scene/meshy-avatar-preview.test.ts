import { describe, expect, it } from 'vitest';
import { fitAvatarBounds, previewPlaybackRate } from './meshy-avatar-preview';

describe('fitAvatarBounds', () => {
  it('centers a model on the floor at the requested height', () => {
    expect(
      fitAvatarBounds(
        {
          min: { x: -2, y: -1, z: -3 },
          max: { x: 2, y: 7, z: 5 },
        },
        2,
      ),
    ).toEqual({
      scale: 0.25,
      offset: [-0, 0.25, -0.25],
    });
  });

  it('rejects a model with no measurable height', () => {
    expect(() =>
      fitAvatarBounds({ min: { x: 0, y: 1, z: 0 }, max: { x: 1, y: 1, z: 1 } }, 2),
    ).toThrow('Avatar bounds must have a positive height');
  });
});

describe('previewPlaybackRate', () => {
  it('preserves the authored animation speed in native mode', () => {
    expect(previewPlaybackRate('native', 1.2)).toBe(1);
  });

  it('fits one complete walk cycle into the 600ms game move', () => {
    expect(previewPlaybackRate('game', 1.2)).toBe(2);
  });

  it('stops the mixer while the preview is paused', () => {
    expect(previewPlaybackRate('game', 1.2, false)).toBe(0);
  });
});
