import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  // S15P21C204-353. 데모 방은 경기 방 예산 밖에서 따로 센다(312). 운영 모드가 달라도 같은 값이고,
  // 서버 스키마가 받는 범위(1~3) 안이어야 기동이 막히지 않는다.
  it('gives both product overlays the same in-range demo room budget', () => {
    const demoBudget = (mode: string) => {
      const text = readFileSync(join(process.cwd(), productCapacityOverlay(mode)), 'utf8');
      const values = [...text.matchAll(/^\s+DEMO_MAX_ROOMS: '(\d+)'$/gm)].map((m) => m[1]);
      expect(values, mode).toHaveLength(1);
      return Number(values[0]);
    };
    expect(demoBudget('continuous')).toBe(3);
    expect(demoBudget('attested')).toBe(demoBudget('continuous'));
  });

  // S15P21C204-372. 방 만들기는 대기방 예산(30)을, 경기는 MAX_ROOMS 를 쓴다. 두 운영 모드가 같고,
  // 경기 예산보다 작지 않으며 서버 스키마(1~50) 안이어야 기동이 막히지 않는다.
  it('gives both product overlays the same lobby room budget, not below the match budget', () => {
    const lobbyBudget = (mode: string) => {
      const text = readFileSync(join(process.cwd(), productCapacityOverlay(mode)), 'utf8');
      const values = [...text.matchAll(/^\s+LOBBY_MAX_ROOMS: '(\d+)'$/gm)].map((m) => m[1]);
      expect(values, mode).toHaveLength(1);
      return Number(values[0]);
    };
    expect(lobbyBudget('continuous')).toBe(30);
    expect(lobbyBudget('attested')).toBe(lobbyBudget('continuous'));
    expect(lobbyBudget('continuous')).toBeGreaterThanOrEqual(
      Number(readProductCapacity(process.cwd(), 'continuous').MAX_ROOMS),
    );
    expect(lobbyBudget('continuous')).toBeLessThanOrEqual(50);
  });

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
