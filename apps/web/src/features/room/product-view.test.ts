import { expect, it, vi } from 'vitest';
import type { PrivateView, PrivateViewWire } from '@kkakkung/protocol/game-schema';
import { createProductView } from './product-view';
import { roundFixture, viewFixture } from './product-fixture';

/**
 * S15P21C204-326. 판을 전선 모양으로 만든다. `omit` 이면 누적 지식을 빼고 보낸다 — 서버가
 * "직전에 보낸 것과 같다"고 판단한 판의 모습이다. revision 은 그 지식이 바뀔 때만 오른다.
 */
function wire(view: PrivateView, knowledgeRevision = 1, omit = false): PrivateViewWire {
  const { knownTerrain, knownActiveExits, ...rest } = view;
  return omit
    ? { ...rest, knowledgeRevision }
    : { ...rest, knowledgeRevision, knownTerrain, knownActiveExits };
}

it('replaces knowledge and closed exits rather than merging snapshots', () => {
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync: vi.fn() });
  views.round(roundFixture());
  views.receive(wire(viewFixture()));
  views.round(roundFixture({ stateVersion: 11 }));
  views.receive(wire(viewFixture({ stateVersion: 11, knownActiveExits: [] }), 2));
  expect(views.view?.knownActiveExits).toEqual([]);
  expect(views.receive(wire(viewFixture()))).toBe(false);
});
it('clears at phase change and resyncs independently when no view arrives', () => {
  let now = 0;
  const resync = vi.fn();
  const views = createProductView({ now: () => now, changed: vi.fn(), resync });
  views.round(roundFixture());
  views.receive(wire(viewFixture()));
  views.round(roundFixture({ phase: 'RESULT', stateVersion: 11 }));
  expect(views.view).toBeNull();
  now = 1000;
  views.poll();
  expect(resync).toHaveBeenCalledOnce();
  views.receive(wire(viewFixture({ stateVersion: 11 })));
  expect(views.view).not.toBeNull();
});
it('rejects mismatched scope identity, buffers a single future view and prevents ended-player resurrection', () => {
  let now = 0;
  const resync = vi.fn();
  const views = createProductView({ now: () => now, changed: vi.fn(), resync });
  views.round(roundFixture());
  views.receive(wire(viewFixture()));
  expect(
    views.receive(
      wire(
        viewFixture({
          stateVersion: 11,
          gameScope: { kind: 'game', revision: 3, gameInstanceId: 'wrong' },
        }),
      ),
    ),
  ).toBe(false);
  expect(resync).toHaveBeenCalledOnce();
  views.receive(
    wire(
      viewFixture({
        stateVersion: 12,
        self: { playerId: 'self', role: 'runner', status: 'ESCAPED' },
      }),
    ),
  );
  expect(views.view?.stateVersion).toBe(10);
  views.round(roundFixture({ stateVersion: 12 }));
  expect(views.view?.knownTerrain).toEqual([]);
  views.round(roundFixture({ stateVersion: 13 }));
  expect(views.receive(wire(viewFixture({ stateVersion: 13 })))).toBe(false);
  now = 2000;
  views.poll();
});
it('keeps the projected world when an ended runner is spectating', () => {
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync: vi.fn() });
  views.round(roundFixture({ stateVersion: 11 }));
  const projected = viewFixture({
    stateVersion: 11,
    self: { playerId: 'self', role: 'runner', status: 'CAPTURED' },
    spectating: {
      targetId: 'runner-a',
      cell: { x: 7, y: 8 },
      dir: 2,
      action: null,
      candidates: ['runner-a', 'runner-b'],
    },
  });

  expect(views.receive(wire(projected))).toBe(true);
  expect(views.view).toMatchObject({
    spectating: { targetId: 'runner-a', cell: { x: 7, y: 8 }, dir: 2 },
    knownTerrain: projected.knownTerrain,
    visibleCells: projected.visibleCells,
  });
});
it('discards practice knowledge through none and game scopes without media-generation coupling', () => {
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync: vi.fn() });
  const practice = viewFixture({
    gameScope: { kind: 'practice', gameInstanceId: 'practice', revision: 1 },
  });
  views.round(roundFixture({ phase: 'TEAM_PRACTICE' }));
  views.receive(wire(practice));
  views.round(roundFixture({ phase: 'MAP_FINALIZING', stateVersion: 11 }));
  views.receive(
    wire(
      viewFixture({
        stateVersion: 11,
        gameScope: { kind: 'none', gameInstanceId: null, revision: 2 },
        self: null,
        knownTerrain: [],
        knownActiveExits: [],
        visibleCells: [],
        visibleWallFaces: [],
      }),
      2,
    ),
  );
  views.round(roundFixture({ phase: 'GAME_LOADING', stateVersion: 12 }));
  views.receive(wire(viewFixture({ stateVersion: 12 }), 3));
  expect(views.receive(wire({ ...practice, stateVersion: 13 }, 4))).toBe(false);
  expect(views.view?.gameScope.kind).toBe('game');
});

// S15P21C204-326. 누적 지식이 생략된 판을 되돌리는 쪽.
it('fills an omitted knowledge pair from the one it already holds', () => {
  const changed = vi.fn();
  const resync = vi.fn();
  const views = createProductView({ now: () => 0, changed, resync });
  const full = viewFixture();
  views.round(roundFixture());
  expect(views.receive(wire(full))).toBe(true);
  // 걸어서 시야만 바뀐 판: 지식은 빠져 온다.
  views.round(roundFixture({ stateVersion: 11 }));
  expect(
    views.receive(wire(viewFixture({ stateVersion: 11, visibleCells: [{ x: 2, y: 1 }] }), 1, true)),
  ).toBe(true);
  expect(views.view?.knownTerrain).toEqual(full.knownTerrain);
  expect(views.view?.knownActiveExits).toEqual(full.knownActiveExits);
  expect(views.view?.visibleCells).toEqual([{ x: 2, y: 1 }]);
  expect(resync).not.toHaveBeenCalled();
});

it('asks for a resync instead of drawing a map it cannot account for', () => {
  const resync = vi.fn();
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync });
  views.round(roundFixture());
  views.receive(wire(viewFixture()));
  // revision 2 를 실어 온 판을 놓친 뒤, 2 를 생략한 판이 온다. 1 을 그려서는 안 된다.
  views.round(roundFixture({ stateVersion: 12 }));
  expect(views.receive(wire(viewFixture({ stateVersion: 12 }), 2, true))).toBe(false);
  expect(views.view?.stateVersion).toBe(10);
  expect(resync).toHaveBeenCalledOnce();
  // 한쪽만 실려 온 판도 뜻을 알 수 없으므로 같은 대우를 받는다.
  const half = { ...wire(viewFixture({ stateVersion: 12 }), 2), knownActiveExits: undefined };
  delete half.knownActiveExits;
  expect(views.receive(half)).toBe(false);
  expect(views.view?.stateVersion).toBe(10);
});

it('holds no knowledge across a new match and never reuses the old revision', () => {
  const resync = vi.fn();
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync });
  views.round(roundFixture());
  views.receive(wire(viewFixture()));
  // 새 경기는 revision 을 1 부터 다시 센다. 이전 경기의 1 을 물려받으면 안 된다.
  views.round(roundFixture({ matchId: 'm2', stateVersion: 0 }));
  expect(views.receive(wire(viewFixture({ matchId: 'm2', stateVersion: 0 }), 1, true))).toBe(false);
  expect(resync).toHaveBeenCalledOnce();
});

it('does not let a view it discards replace the knowledge it holds', () => {
  const resync = vi.fn();
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync });
  const first = viewFixture();
  const grown = viewFixture({
    stateVersion: 11,
    knownTerrain: [...first.knownTerrain, { x: 4, y: 4, kind: 'floor' }],
  });
  views.round(roundFixture());
  views.receive(wire(first));
  views.round(roundFixture({ stateVersion: 11 }));
  views.receive(wire(grown, 2));
  // 지난 판이 다시 배달돼도 들고 있는 것은 revision 2 그대로여야 한다.
  expect(views.receive(wire(first))).toBe(false);
  views.round(roundFixture({ stateVersion: 12 }));
  expect(views.receive(wire(viewFixture({ stateVersion: 12 }), 2, true))).toBe(true);
  expect(views.view?.knownTerrain).toEqual(grown.knownTerrain);
  expect(resync).not.toHaveBeenCalled();
});
