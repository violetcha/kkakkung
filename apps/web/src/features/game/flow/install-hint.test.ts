import { describe, expect, it } from 'vitest';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { crosshairState, firstInstallPrompt, installHint } from './install-hint';

const TICK = 100;

/** 북쪽(dir 0)을 보는 술래. 앞 칸 (1,0)의 남쪽 면(side 2)이 내 쪽을 향한 벽이다. */
function tagger(patch: Record<string, unknown> = {}, view: Partial<PrivateView> = {}): PrivateView {
  const base = viewFixture({
    visibleWallFaces: [{ x: 1, y: 0, side: 2 }],
    visibleEntities: [],
    ...view,
  });
  const self = base.self!;
  if (self.status !== 'ACTIVE') throw new Error();
  return {
    ...base,
    self: {
      ...self,
      role: 'tagger',
      cell: { x: 1, y: 1 },
      dir: 0,
      equipment: { sensor: 2, trap: 1 },
      ...patch,
    },
  };
}

const hint = (view: PrivateView | null, kind: 'sensor' | 'trap' = 'sensor') =>
  installHint(view, kind, TICK);

describe('installHint', () => {
  it('says the sensor can go here when I am standing still facing a wall with stock', () => {
    const ready = hint(tagger());
    expect(ready?.ready).toBe(true);
    expect(ready?.block).toBeNull();
    expect(ready?.text).toContain('설치할 수 있어요');
    expect(ready?.text).toContain('F');
  });

  it('names the one thing in the way instead of just going quiet', () => {
    const cases = [
      [{ action: { kind: 'move', startTick: 0, endTick: 200 } }, 'moving', '멈춘 뒤에'],
      [
        { installation: { installationId: 'i', startTick: 0, endTick: 10 } },
        'installing',
        '설치 중',
      ],
      [{ restraintUntilTick: TICK + 40 }, 'restrained', '구속이 풀리면'],
      [{ equipment: { sensor: 0, trap: 1 } }, 'empty', '남은 개수가 없어요'],
    ] as const;
    for (const [patch, block, text] of cases) {
      const result = hint(tagger(patch as Record<string, unknown>));
      expect(result?.block, block).toBe(block);
      expect(result?.ready).toBe(false);
      expect(result?.text).toContain(text);
    }
  });

  it('asks the tagger to face a wall before a sensor, but lets a trap go on the floor', () => {
    const noWall = tagger({}, { visibleWallFaces: [] });
    expect(hint(noWall, 'sensor')?.block).toBe('no-wall');
    expect(hint(noWall, 'trap')?.ready).toBe(true);
    // 다른 면을 보고 있으면 앞의 벽이 아니다.
    expect(hint(tagger({ dir: 1 }), 'sensor')?.block).toBe('no-wall');
  });

  it('refuses a cell that already carries a device, mine or one I can see', () => {
    const mine = tagger({
      ownedEquipment: [
        {
          equipmentId: 'e',
          kind: 'trap',
          cell: { x: 1, y: 1 },
          wall: null,
          state: 'ARMED',
          armedTick: 0,
        },
      ],
    });
    expect(hint(mine)?.block).toBe('occupied');
    const seen = tagger(
      {},
      {
        visibleEntities: [{ id: 't', kind: 'trap', cell: { x: 1, y: 1 }, state: 'ARMED' }],
      },
    );
    expect(hint(seen)?.block).toBe('occupied');
    // 다른 칸의 장비는 막지 않는다.
    const elsewhere = tagger(
      {},
      { visibleEntities: [{ id: 't', kind: 'trap', cell: { x: 5, y: 5 }, state: 'ARMED' }] },
    );
    expect(hint(elsewhere)?.ready).toBe(true);
  });

  it('stays silent for anyone who cannot install', () => {
    expect(hint(null)).toBeNull();
    expect(hint(viewFixture())).toBeNull(); // 도망자
  });
});

describe('crosshairState', () => {
  it('only changes the crosshair for someone who can install', () => {
    expect(crosshairState(null)).toBe('none');
    expect(crosshairState(hint(tagger())!)).toBe('ready');
    expect(crosshairState(hint(tagger({ equipment: { sensor: 0, trap: 0 } }))!)).toBe('blocked');
  });
});

describe('firstInstallPrompt', () => {
  it('offers the prompt only to a tagger who has never placed anything and can place now', () => {
    expect(firstInstallPrompt(tagger(), 'sensor', TICK)).toContain('F');
    // 이미 놓아 봤으면 다시 안내하지 않는다.
    const placed = tagger({
      ownedEquipment: [
        {
          equipmentId: 'e',
          kind: 'trap',
          cell: { x: 4, y: 4 },
          wall: null,
          state: 'ARMED',
          armedTick: 0,
        },
      ],
    });
    expect(firstInstallPrompt(placed, 'sensor', TICK)).toBeNull();
    // 지금 놓을 수 없으면 아직 안내하지 않는다.
    expect(firstInstallPrompt(tagger({ dir: 1 }), 'sensor', TICK)).toBeNull();
    expect(firstInstallPrompt(viewFixture(), 'sensor', TICK)).toBeNull();
  });
});
