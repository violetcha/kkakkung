import { describe, expect, it } from 'vitest';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { ROLE_COLORS } from '../scene/role-colors';
import {
  MINIMAP_COLORS,
  drawMinimap,
  minimapLayout,
  minimapTerrain,
  roleMarkColor,
  wallBandRect,
  type MinimapContext,
} from './minimap-render';

type Call = Readonly<{ op: string; args: readonly unknown[]; fill: string; stroke: string }>;

/** 캔버스 대신 호출을 적어 두는 기록기. 실제 그림 대신 무엇을 어떤 색으로 그렸는지 본다. */
function recorder() {
  const calls: Call[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
  } as unknown as MinimapContext & { fillStyle: string; strokeStyle: string };
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args, fill: String(ctx.fillStyle), stroke: String(ctx.strokeStyle) });
    };
  for (const op of [
    'fillRect',
    'strokeRect',
    'fillText',
    'beginPath',
    'moveTo',
    'lineTo',
    'closePath',
    'stroke',
    'fill',
    'arc',
    'save',
    'restore',
    'translate',
    'rotate',
  ] as const)
    (ctx as unknown as Record<string, unknown>)[op] = record(op);
  return { ctx, calls };
}

const fillsOf = (calls: readonly Call[], color: string) =>
  calls.filter((call) => call.op === 'fillRect' && call.fill === color);

/** 교환 전: 한 칸만 안다. */
const before = (): PrivateView =>
  viewFixture({
    knownTerrain: [
      { x: 1, y: 1, kind: 'floor' },
      { x: 1, y: 1, side: 0, kind: 'wall' },
    ],
  });

/** 교환 뒤: 아군이 본 칸이 더해진다. */
const after = (): PrivateView =>
  viewFixture({
    knownTerrain: [
      { x: 1, y: 1, kind: 'floor' },
      { x: 1, y: 1, side: 0, kind: 'wall' },
      { x: 2, y: 1, kind: 'floor' },
      { x: 3, y: 1, kind: 'floor' },
      { x: 3, y: 1, side: 1, kind: 'wall' },
      { x: 3, y: 2, kind: 'floor' },
    ],
  });

describe('minimapLayout', () => {
  it('keeps a whole number of pixels per cell and centres the leftover', () => {
    const layout = minimapLayout(240, 32);
    expect(Number.isInteger(layout.unit)).toBe(true);
    expect(layout.unit).toBe(7);
    expect(layout.span).toBe(224);
    expect(layout.offset).toBe(8);
    expect(Number.isInteger(layout.band)).toBe(true);
    expect(layout.band).toBeGreaterThanOrEqual(2);
    expect(layout.gridStep).toBe(1);
  });

  it('thins the grid and keeps the wall band visible when cells get small', () => {
    const hud = minimapLayout(168, 32); // 경기 화면 오버레이 크기
    expect(hud.unit).toBe(5);
    expect(hud.band).toBe(2);
    // 칸이 작으면 격자를 성기게 그어 그물처럼 보이지 않게 한다.
    expect(hud.gridStep).toBe(4);
    expect(minimapLayout(320, 32).gridStep).toBe(1);
  });

  it('never collapses a cell below one pixel even on a tiny map', () => {
    const layout = minimapLayout(10, 32);
    expect(layout.unit).toBe(1);
    expect(layout.band).toBe(1);
  });
});

describe('minimapTerrain', () => {
  it('splits known terrain into floors and walls and counts what is still unseen', () => {
    const terrain = minimapTerrain(after().knownTerrain, 32);
    expect(terrain.floors).toHaveLength(4);
    expect(terrain.walls).toHaveLength(2);
    expect(terrain.unknown).toBe(32 * 32 - 4);
  });

  it('drops coordinates outside the map instead of drawing them', () => {
    const terrain = minimapTerrain(
      [
        { x: 0, y: 0, kind: 'floor' },
        { x: 40, y: 2, kind: 'floor' },
        { x: -1, y: 0, kind: 'floor' },
      ],
      32,
    );
    expect(terrain.floors).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('wallBandRect', () => {
  it('lays a thick band on the cell edge the wall belongs to', () => {
    const layout = minimapLayout(320, 32); // unit 10, band 3, offset 0
    expect(wallBandRect({ x: 1, y: 1, side: 0 }, layout)).toEqual({
      x: 10,
      y: 10,
      width: 10,
      height: 3,
    });
    expect(wallBandRect({ x: 1, y: 1, side: 2 }, layout)).toEqual({
      x: 10,
      y: 17,
      width: 10,
      height: 3,
    });
    expect(wallBandRect({ x: 1, y: 1, side: 1 }, layout)).toEqual({
      x: 17,
      y: 10,
      width: 3,
      height: 10,
    });
    expect(wallBandRect({ x: 1, y: 1, side: 3 }, layout)).toEqual({
      x: 10,
      y: 10,
      width: 3,
      height: 10,
    });
  });
});

describe('drawMinimap', () => {
  it('tells walls, visited floor and unvisited cells apart by shape and colour', () => {
    const { ctx, calls } = recorder();
    drawMinimap(ctx, { view: after(), size: 320 });
    // 안 가 본 곳은 옅은 격자선뿐이고 칸을 채우지 않는다.
    expect(fillsOf(calls, MINIMAP_COLORS.unknownGrid)).toHaveLength(0);
    expect(
      calls.some((call) => call.op === 'lineTo' && call.stroke === MINIMAP_COLORS.unknownGrid),
    ).toBe(true);
    // 바닥은 칸을 가득 채운다.
    const floors = fillsOf(calls, MINIMAP_COLORS.floor);
    expect(floors).toHaveLength(4);
    expect(floors[0]?.args.slice(2)).toEqual([10, 10]);
    // 벽은 더 밝은 색의 얇고 긴 띠라 바닥과 모양으로도 갈린다.
    const walls = fillsOf(calls, MINIMAP_COLORS.wall);
    expect(walls).toHaveLength(2);
    for (const wall of walls) {
      const [, , width, height] = wall.args as number[];
      expect(Math.min(width!, height!)).toBe(3);
      expect(Math.max(width!, height!)).toBe(10);
    }
    expect(MINIMAP_COLORS.floor).not.toBe(MINIMAP_COLORS.wall);
  });

  it('shows more of the map after a map exchange and nothing less', () => {
    const first = recorder();
    drawMinimap(first.ctx, { view: before(), size: 320 });
    const second = recorder();
    drawMinimap(second.ctx, { view: after(), size: 320 });
    expect(minimapTerrain(before().knownTerrain).unknown).toBeGreaterThan(
      minimapTerrain(after().knownTerrain).unknown,
    );
    expect(fillsOf(second.calls, MINIMAP_COLORS.floor).length).toBeGreaterThan(
      fillsOf(first.calls, MINIMAP_COLORS.floor).length,
    );
    expect(fillsOf(second.calls, MINIMAP_COLORS.wall).length).toBeGreaterThan(
      fillsOf(first.calls, MINIMAP_COLORS.wall).length,
    );
    // 격자는 교환과 무관하게 지도 전체에 그대로 있다.
    const grid = (calls: readonly Call[]) =>
      calls.filter((call) => call.op === 'moveTo' && call.stroke === MINIMAP_COLORS.unknownGrid);
    expect(grid(first.calls).length).toBe(grid(second.calls).length);
  });

  it('draws my own mark in the role colour the 3D cloth uses', () => {
    const view = before();
    const self = view.self!;
    if (self.status !== 'ACTIVE') throw new Error();
    const runner = recorder();
    drawMinimap(runner.ctx, { view, size: 320 });
    expect(
      runner.calls.some((call) => call.op === 'fill' && call.fill === ROLE_COLORS.runner.cloth),
    ).toBe(true);
    const tagger = recorder();
    drawMinimap(tagger.ctx, {
      view: { ...view, self: { ...self, role: 'tagger' } },
      size: 320,
    });
    expect(
      tagger.calls.some((call) => call.op === 'fill' && call.fill === ROLE_COLORS.tagger.cloth),
    ).toBe(true);
    expect(roleMarkColor('tagger')).not.toBe(roleMarkColor('runner'));
  });

  it('still paints the background grid when there is no view to draw', () => {
    const { ctx, calls } = recorder();
    const layout = drawMinimap(ctx, { view: null, size: 320 });
    expect(layout.unit).toBe(10);
    expect(fillsOf(calls, MINIMAP_COLORS.background)).toHaveLength(1);
    expect(fillsOf(calls, MINIMAP_COLORS.floor)).toHaveLength(0);
  });

  it('draws the demo operator exit as a distinct marker only when supplied', () => {
    const ordinary = recorder();
    drawMinimap(ordinary.ctx, { view: before(), size: 320 });
    expect(ordinary.calls.some((call) => call.stroke === MINIMAP_COLORS.operatorExit)).toBe(false);

    const demo = recorder();
    drawMinimap(demo.ctx, {
      view: before(),
      size: 320,
      operatorExit: { x: 1, y: 1 },
    });
    expect(
      demo.calls.some((call) => call.op === 'arc' && call.stroke === MINIMAP_COLORS.operatorExit),
    ).toBe(true);
    expect(
      demo.calls.some(
        (call) => call.op === 'fillText' && call.fill === MINIMAP_COLORS.operatorExit,
      ),
    ).toBe(true);
    // The operator marker replaces the regular square marker at that same cell.
    expect(
      demo.calls.some(
        (call) => call.op === 'strokeRect' && call.stroke === MINIMAP_COLORS.exitMine,
      ),
    ).toBe(false);
  });
});
