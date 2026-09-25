// S15P21C204-386. 덫·감지기 표식은 종류가 갈리고, 물결로 눈을 끌고, 끝에 흐려지며, 창 밖이면
// 가장자리 화살표로 남는다.
import { expect, it } from 'vitest';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { drawMinimap, type MinimapContext } from './minimap-render';
import {
  compassFrom,
  edgeArrow,
  HUNTER_MARKER_STYLES,
  hunterMarkerPhase,
} from './hunter-marker-style';

const marker = (kind: 'trap' | 'sensor', point = { x: 2.5, y: 2 }) => ({
  markerId: `mk-${kind}`,
  kind,
  point,
  occurredTick: 100,
  showAtTick: 100,
  expiresTick: 140,
});

it('tells a trap from a sensor by shape and colour, and keeps exchanges quiet', () => {
  expect(HUNTER_MARKER_STYLES.trap.shape).not.toBe(HUNTER_MARKER_STYLES.sensor.shape);
  expect(HUNTER_MARKER_STYLES.trap.rgb).not.toBe(HUNTER_MARKER_STYLES.sensor.rgb);
  expect(HUNTER_MARKER_STYLES.trap.ripple && HUNTER_MARKER_STYLES.sensor.ripple).toBe(true);
  expect(HUNTER_MARKER_STYLES.exchange.ripple).toBe(false);
});

it('stays solid, then fades over the last half second, while ripples keep spreading', () => {
  const trap = marker('trap');
  expect(hunterMarkerPhase(trap, 100).alpha).toBe(1);
  expect(hunterMarkerPhase(trap, 129).alpha).toBe(1);
  expect(hunterMarkerPhase(trap, 135).alpha).toBeCloseTo(0.5);
  expect(hunterMarkerPhase(trap, 140).alpha).toBe(0);
  const early = hunterMarkerPhase(trap, 100).rings;
  const later = hunterMarkerPhase(trap, 105).rings;
  expect(later[0]!.radiusCells).toBeGreaterThan(early[0]!.radiusCells);
  expect(later[0]!.alpha).toBeLessThan(early[0]!.alpha);
  // 창 밖 화살표는 물결 주기로 밝아졌다(1) 어두워진다(0.3).
  expect(hunterMarkerPhase(trap, 100).pulse).toBeCloseTo(1);
  expect(hunterMarkerPhase(trap, 110).pulse).toBeCloseTo(0.3);
});

it('points an edge arrow from the window centre toward an off-window event', () => {
  const box = { min: 10, max: 110 };
  const east = edgeArrow({ x: 60, y: 60 }, { x: 400, y: 60 }, box)!;
  expect(east).toEqual({ x: 110, y: 60, angle: 0 });
  const northWest = edgeArrow({ x: 60, y: 60 }, { x: -100, y: -100 }, box)!;
  expect(northWest.x).toBeCloseTo(10);
  expect(northWest.y).toBeCloseTo(10);
  expect(edgeArrow({ x: 60, y: 60 }, { x: 60, y: 60 }, box)).toBeNull();
});

it('names the direction with north up, and says nearby when it is close', () => {
  expect(compassFrom({ x: 10, y: 10 }, { x: 10, y: 2 })).toBe('북쪽 약 8칸');
  expect(compassFrom({ x: 10, y: 10 }, { x: 18, y: 2 })).toBe('북동쪽 약 11칸');
  expect(compassFrom({ x: 10, y: 10 }, { x: 2, y: 18 })).toBe('남서쪽 약 11칸');
  expect(compassFrom({ x: 10, y: 10 }, { x: 11, y: 10 })).toBe('근처');
});

it('draws a far trap as an arrow on the small window edge instead of dropping it', () => {
  const fills: string[] = [];
  const ctx = new Proxy({ fillStyle: '', strokeStyle: '' } as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      if (key === 'fill') return () => fills.push(String(target.fillStyle));
      return () => undefined;
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as MinimapContext;
  const base = viewFixture();
  const tagger: PrivateView = {
    ...base,
    self: {
      ...(base.self as Extract<PrivateView['self'], { status: 'ACTIVE' }>),
      role: 'tagger',
    },
    knownActiveExits: [],
  };
  drawMinimap(ctx, {
    view: tagger,
    size: 240,
    tick: 110,
    window: 11,
    markers: [marker('trap', { x: 30, y: 30 })],
  });
  expect(fills.some((fill) => fill.startsWith(`rgba(${HUNTER_MARKER_STYLES.trap.rgb}`))).toBe(true);
});
