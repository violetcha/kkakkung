import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  productCapacityOverlay,
  readProductCapacity,
} from '../../scripts/lib/product-capacity.mjs';

describe('deployed product room capacity', () => {
  it.each(['continuous', 'attested'])(
    'reads one whole-room capacity from the %s Compose overlay',
    (mode) => {
      const capacity = readProductCapacity(process.cwd(), mode);
      expect(Number(capacity.MAX_SLOTS)).toBe(Number(capacity.MAX_ROOMS) * 6);
      expect(Number(capacity.MAX_ROOMS)).toBeGreaterThanOrEqual(1);
      expect(Number(capacity.MAX_ROOMS)).toBeLessThanOrEqual(10);
    },
  );

  it('keeps both product overlays at the same capacity', () => {
    expect(readProductCapacity(process.cwd(), 'continuous')).toEqual(
      readProductCapacity(process.cwd(), 'attested'),
    );
  });

  it.each([
    ['missing slots', "      MAX_ROOMS: '3'\n"],
    ['unquoted value', '      MAX_ROOMS: 3\n      MAX_SLOTS: 18\n'],
    ['partial room', "      MAX_ROOMS: '3'\n      MAX_SLOTS: '17'\n"],
    ['duplicate key', "      MAX_ROOMS: '3'\n      MAX_ROOMS: '2'\n      MAX_SLOTS: '18'\n"],
  ])('rejects %s', (_name, environment) => {
    const root = mkdtempSync(join(tmpdir(), 'kkakkung-capacity-'));
    try {
      mkdirSync(join(root, 'infra'));
      writeFileSync(
        join(root, productCapacityOverlay('continuous')),
        `services:\n  game-server:\n    environment:\n${environment}`,
      );
      expect(() => readProductCapacity(root, 'continuous')).toThrow('PRODUCT_CAPACITY_INVALID');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
