import { describe, expect, it } from 'vitest';
import { CHARACTER, cellPosition, wallModel } from './scene-model';

describe('product scene coordinates', () => {
  it('keeps the cell origin and a shared head/body size for both teams', () => {
    expect(cellPosition({ x: 0, y: 31 })).toEqual([0, 0, 31]);
    expect(CHARACTER.head).toBeGreaterThan(CHARACTER.body);
  });
  it('draws only the observed side with its inward normal', () => {
    expect(([0, 1, 2, 3] as const).map((side) => wallModel({ x: 4, y: 5, side }).position)).toEqual(
      [
        [4, 0.6, 4.5],
        [4.5, 0.6, 5],
        [4, 0.6, 5.5],
        [3.5, 0.6, 5],
      ],
    );
    expect(wallModel({ x: 4, y: 5, side: 0 }).normal).toEqual([-0, 0, 1]);
  });
});
