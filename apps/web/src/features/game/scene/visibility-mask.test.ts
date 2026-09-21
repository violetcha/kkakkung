import { expect, it } from 'vitest';
import { viewFixture } from '../../room/product-fixture';
import { visibilityMask } from './visibility-mask';
import { verticalFov } from './FirstPersonCamera';
it('현재 시야가 비면 아무것도 그리지 않는다', () => {
  // 누적 지도(`knownTerrain`)는 별도 필드다. 현재 시야가 비었는데 기억한 지형으로 구멍을
  // 메우면 안 된다.
  const view = viewFixture({ visibleCells: [], knownTerrain: [{ x: 10, y: 10, kind: 'floor' }] });
  expect(visibilityMask(view).cells).toEqual([]);
});
it('서버가 보낸 셀을 거리로 다시 자르지 않는다', () => {
  // S15P21C204-301. 서버는 범위 밖을 보내지 않으므로 여기서 거르면 누락만 생긴다.
  const far = [
    { x: 10, y: 10 },
    { x: 99, y: 99 },
  ];
  expect(visibilityMask(viewFixture({ visibleCells: far })).cells).toEqual(far);
});
it('시점 주인이 없으면 비운다', () => {
  // 종료했고 관전 대상도 없는 사이의 프레임이다. 누구의 시야인지 정할 수 없다.
  const view = viewFixture({
    self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
    visibleCells: [{ x: 1, y: 1 }],
  });
  expect(visibilityMask(view)).toEqual({ cells: [], walls: [], players: [] });
});
it('uses the watched runner as the visibility origin for a spectator', () => {
  const view = viewFixture({
    self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
    spectating: {
      targetId: 'runner-a',
      cell: { x: 7, y: 8 },
      dir: 1,
      action: null,
      candidates: ['runner-a'],
    },
    visibleCells: [
      { x: 7, y: 8 },
      { x: 10, y: 8 },
      { x: 11, y: 8 },
    ],
    visibleEntities: [
      { id: 'runner-a', kind: 'player', cell: { x: 7, y: 8 }, dir: 1, action: null },
      { id: 'tagger-a', kind: 'player', cell: { x: 8, y: 8 }, dir: 3, action: null },
    ],
  });

  // 관전자는 대상이 받는 시야를 그대로 받는다. 대상 본인만 빼고 자르지 않는다.
  expect(visibilityMask(view)).toMatchObject({
    cells: [
      { x: 7, y: 8 },
      { x: 10, y: 8 },
      { x: 11, y: 8 },
    ],
    players: [{ id: 'tagger-a' }],
  });
});
it('keeps eighty degrees horizontally across screen ratios', () => {
  for (const aspect of [9 / 16, 16 / 9, 32 / 9])
    expect(
      (2 * Math.atan(Math.tan((verticalFov(aspect) * Math.PI) / 360) * aspect) * 180) / Math.PI,
    ).toBeCloseTo(80);
});
