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
  windowOrigin,
  minimapDrawKey,
  MINIMAP_WINDOW_CELLS,
  MINIMAP_CELLS,
  zoomedWindow,
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
    'rect',
    'clip',
  ] as const)
    (ctx as unknown as Record<string, unknown>)[op] = record(op);
  (ctx as unknown as Record<string, unknown>).createRadialGradient = () => ({
    addColorStop: () => undefined,
    toString: () => 'gradient',
  });
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

// S15P21C204-295. 경기 화면의 근접 창: 내 주변 홀수 칸만 확대해 그리고 내 표식이 항상 가운데다.
describe('drawMinimap window mode', () => {
  it('centres my cell in an odd window and drops terrain outside it', () => {
    expect(MINIMAP_WINDOW_CELLS % 2).toBe(1);
    expect(windowOrigin({ x: 10, z: 20 }, 11)).toEqual({ x: 5, y: 15 });
    const view = viewFixture({
      knownTerrain: [
        { x: 1, y: 1, kind: 'floor' },
        { x: 30, y: 30, kind: 'floor' }, // 창 밖
        { x: 30, y: 30, side: 2, kind: 'wall' },
      ],
    });
    const { ctx, calls } = recorder();
    const layout = drawMinimap(ctx, { view, size: 165, window: 11 });
    // 11칸 창이라 칸이 15px: 전체 지도(32칸, 5px)보다 세 배 크다.
    expect(layout.cells).toBe(11);
    expect(layout.unit).toBe(15);
    expect(fillsOf(calls, MINIMAP_COLORS.windowFloor)).toHaveLength(1);
    expect(fillsOf(calls, MINIMAP_COLORS.wall)).toHaveLength(0);
    // 창 모드는 격자 없이 어두운 바탕만 둔다.
    expect(
      calls.some((call) => call.op === 'lineTo' && call.stroke === MINIMAP_COLORS.unknownGrid),
    ).toBe(false);
    // 내 위치는 창 한가운데 칸(5,5)의 중심으로 옮겨지고, 흰 점과 흰 시야 부채꼴로 그린다.
    const translate = calls.find((call) => call.op === 'translate');
    expect(translate?.args).toEqual([layout.offset + 5.5 * 15, layout.offset + 5.5 * 15]);
    expect(calls.some((call) => call.op === 'fill' && call.fill === 'gradient')).toBe(true);
    expect(calls.some((call) => call.op === 'fill' && call.fill === MINIMAP_COLORS.me)).toBe(true);
    expect(calls.filter((call) => call.op === 'arc')).toHaveLength(2);
    expect(calls.some((call) => call.op === 'fillText' && call.args[0] === 'N')).toBe(true);
  });

  // S15P21C204-314. 창 모드는 내 주변 좌표로 그린다. 절대 좌표로 그리면 엉뚱한 칸에 찍힌다.
  it('places the operator exit relative to me in the window, and drops it outside', () => {
    const self = viewFixture().self;
    if (self?.status !== 'ACTIVE') throw new Error('fixture self');
    const near = recorder();
    const layout = drawMinimap(near.ctx, {
      view: before(),
      size: 165,
      window: 11,
      operatorExit: { x: self.cell.x + 1, y: self.cell.y },
    });
    const me = near.calls.find((call) => call.op === 'translate')!.args as number[];
    const marker = near.calls.find(
      (call) => call.op === 'arc' && call.stroke === MINIMAP_COLORS.operatorExit,
    );
    expect(marker?.args.slice(0, 2)).toEqual([me[0]! + layout.unit, me[1]]);

    const far = recorder();
    drawMinimap(far.ctx, {
      view: before(),
      size: 165,
      window: 11,
      operatorExit: { x: self.cell.x + 20, y: self.cell.y },
    });
    expect(far.calls.some((call) => call.stroke === MINIMAP_COLORS.operatorExit)).toBe(false);
  });

  it('keeps the full map when no window is requested and still centres nothing', () => {
    const { ctx, calls } = recorder();
    const layout = drawMinimap(ctx, { view: before(), size: 320 });
    expect(layout.cells).toBe(32);
    expect(calls.some((call) => call.op === 'fillText' && call.args[0] === 'N')).toBe(false);
  });
});

// S15P21C204-327. 미니맵은 창 모드에서 프레임마다, 전체 지도에서 서버 패치마다 다시 그려지고
// 있었다. 대부분은 같은 그림이다. 열쇠는 "다시 그릴 필요가 있나"를 판정하되, 움직이는 동안에는
// 반드시 달라져야 한다 — 그렇지 않으면 내 화살표가 멈춘다.
describe('minimapDrawKey', () => {
  const moving = (endTick: number): PrivateView =>
    viewFixture({
      self: {
        ...(viewFixture().self as Extract<PrivateView['self'], { status: 'ACTIVE' }>),
        action: {
          kind: 'move',
          from: { x: 1, y: 1, dir: 0 },
          to: { x: 1, y: 2, dir: 0 },
          startTick: 0,
          endTick,
        },
      },
    });

  it('is the same while nothing that gets drawn has changed', () => {
    const input = { view: before(), size: 320, tick: 10 };
    expect(minimapDrawKey(input)).toBe(minimapDrawKey({ ...input, tick: 11 }));
    // 서 있는 동안에는 tick 이 한참 흘러도 같은 그림이다.
    expect(minimapDrawKey(input)).toBe(minimapDrawKey({ ...input, tick: 5000 }));
  });

  it('changes while the player is walking, so the arrow keeps moving', () => {
    const view = moving(20);
    const keys = [0, 5, 10, 15, 20].map((tick) => minimapDrawKey({ view, size: 320, tick }));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('changes when the map, the exits, the size or the window change', () => {
    const base = { view: before(), size: 320, tick: 10 };
    expect(minimapDrawKey({ ...base, view: after() })).not.toBe(minimapDrawKey(base));
    expect(minimapDrawKey({ ...base, size: 240 })).not.toBe(minimapDrawKey(base));
    expect(minimapDrawKey({ ...base, window: MINIMAP_WINDOW_CELLS })).not.toBe(
      minimapDrawKey(base),
    );
    expect(minimapDrawKey({ ...base, view: viewFixture({ knownActiveExits: [] }) })).not.toBe(
      minimapDrawKey({ ...base, view: viewFixture() }),
    );
  });

  it('changes when a tagger’s past-event marker appears and when it expires', () => {
    const tagger = viewFixture({
      self: {
        ...(viewFixture().self as Extract<PrivateView['self'], { status: 'ACTIVE' }>),
        role: 'tagger',
      },
      knownActiveExits: [],
    });
    const markers = [
      {
        markerId: 'mk',
        kind: 'sensor' as const,
        point: { x: 2.5, y: 2 },
        occurredTick: 100,
        showAtTick: 100,
        expiresTick: 140,
      },
    ];
    const at = (tick: number) => minimapDrawKey({ view: tagger, size: 320, tick, markers });
    expect(at(99)).not.toBe(at(100));
    expect(at(100)).toBe(at(120));
    expect(at(120)).not.toBe(at(140));
  });
});

// S15P21C204-352. M 키로 같은 위젯 안에서 전체 지도까지 줌아웃한다. 두 축척 사이는 이어진 값이다.
describe('drawMinimap zoom', () => {
  it('walks the window out to the whole map and keeps me centred on the way', () => {
    const self = { x: 10, z: 20 };
    expect(zoomedWindow(self, 11, 0)).toEqual({
      cells: 11,
      origin: { x: 5, y: 15 },
      zoom: 0,
    });
    // 끝에서는 전체 지도와 같은 칸 수·기준점이다.
    expect(zoomedWindow(self, 11, 1)).toEqual({
      cells: MINIMAP_CELLS,
      origin: { x: 0, y: 0 },
      zoom: 1,
    });
    const middle = zoomedWindow(self, 11, 0.5);
    expect(middle.cells).toBeGreaterThan(11);
    expect(middle.cells).toBeLessThan(MINIMAP_CELLS);
    // 기준점은 '나를 가운데 둔 창'과 '지도 원점' 사이를 섞은 값이다. 절반이면 절반씩이다.
    const centred = windowOrigin(self, middle.cells);
    expect(middle.origin.x).toBeCloseTo(centred.x * 0.5, 6);
    expect(middle.origin.y).toBeCloseTo(centred.y * 0.5, 6);
    // 지도 원점 쪽으로 다가간다: 남은 거리가 창 기준점보다 짧다.
    expect(Math.abs(middle.origin.y)).toBeLessThan(Math.abs(centred.y));
    // 범위를 벗어난 값은 양 끝으로 잘린다.
    expect(zoomedWindow(self, 11, 2).cells).toBe(MINIMAP_CELLS);
    expect(zoomedWindow(self, 11, -1).cells).toBe(11);
  });

  it('draws the whole map at full zoom and turns the unknown grid on past halfway', () => {
    const view = viewFixture({
      knownTerrain: [
        { x: 1, y: 1, kind: 'floor' },
        { x: 30, y: 30, kind: 'floor' },
      ],
    });
    const out = recorder();
    const layout = drawMinimap(out.ctx, { view, size: 165, window: 11, zoom: 1 });
    // 창에서 버려지던 먼 칸이 전체 지도에서는 둘 다 보인다.
    expect(layout.cells).toBe(MINIMAP_CELLS);
    expect(fillsOf(out.calls, MINIMAP_COLORS.windowFloor)).toHaveLength(2);
    const grid = (calls: readonly Call[]) =>
      calls.some((call) => call.op === 'lineTo' && call.stroke === MINIMAP_COLORS.unknownGrid);
    expect(grid(out.calls)).toBe(true);
    const near = recorder();
    drawMinimap(near.ctx, { view, size: 165, window: 11, zoom: 0.25 });
    expect(grid(near.calls)).toBe(false);
  });

  it('keeps whole pixels at rest and lets them flow only mid transition', () => {
    const view = viewFixture();
    const rest = drawMinimap(recorder().ctx, { view, size: 165, window: 11, zoom: 0 });
    const full = drawMinimap(recorder().ctx, { view, size: 165, window: 11, zoom: 1 });
    expect(Number.isInteger(rest.unit)).toBe(true);
    expect(Number.isInteger(full.unit)).toBe(true);
    const moving = drawMinimap(recorder().ctx, { view, size: 165, window: 11, zoom: 0.4 });
    expect(Number.isInteger(moving.unit)).toBe(false);
  });

  it('redraws while the zoom moves and stays quiet once it settles', () => {
    const view = viewFixture();
    const at = (zoom: number) => minimapDrawKey({ view, size: 165, window: 11, zoom });
    expect(at(0)).not.toBe(at(0.4));
    expect(at(0.4)).not.toBe(at(1));
    expect(at(1)).toBe(at(1));
  });
});
