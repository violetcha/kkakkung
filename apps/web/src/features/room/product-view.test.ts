import { expect, it, vi } from 'vitest';
import { createProductView } from './product-view';
import { roundFixture, viewFixture } from './product-fixture';
it('replaces knowledge and closed exits rather than merging snapshots', () => {
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync: vi.fn() });
  views.round(roundFixture());
  views.receive(viewFixture());
  views.round(roundFixture({ stateVersion: 11 }));
  views.receive(viewFixture({ stateVersion: 11, knownActiveExits: [] }));
  expect(views.view?.knownActiveExits).toEqual([]);
  expect(views.receive(viewFixture())).toBe(false);
});
it('clears at phase change and resyncs independently when no view arrives', () => {
  let now = 0;
  const resync = vi.fn();
  const views = createProductView({ now: () => now, changed: vi.fn(), resync });
  views.round(roundFixture());
  views.receive(viewFixture());
  views.round(roundFixture({ phase: 'RESULT', stateVersion: 11 }));
  expect(views.view).toBeNull();
  now = 1000;
  views.poll();
  expect(resync).toHaveBeenCalledOnce();
  views.receive(viewFixture({ stateVersion: 11 }));
  expect(views.view).not.toBeNull();
});
it('rejects mismatched scope identity, buffers a single future view and prevents ended-player resurrection', () => {
  let now = 0;
  const resync = vi.fn();
  const views = createProductView({ now: () => now, changed: vi.fn(), resync });
  views.round(roundFixture());
  views.receive(viewFixture());
  expect(
    views.receive(
      viewFixture({
        stateVersion: 11,
        gameScope: { kind: 'game', revision: 3, gameInstanceId: 'wrong' },
      }),
    ),
  ).toBe(false);
  expect(resync).toHaveBeenCalledOnce();
  views.receive(
    viewFixture({
      stateVersion: 12,
      self: { playerId: 'self', role: 'runner', status: 'ESCAPED' },
    }),
  );
  expect(views.view?.stateVersion).toBe(10);
  views.round(roundFixture({ stateVersion: 12 }));
  expect(views.view?.knownTerrain).toEqual([]);
  views.round(roundFixture({ stateVersion: 13 }));
  expect(views.receive(viewFixture({ stateVersion: 13 }))).toBe(false);
  now = 2000;
  views.poll();
});
it('discards practice knowledge through none and game scopes without media-generation coupling', () => {
  const views = createProductView({ now: () => 0, changed: vi.fn(), resync: vi.fn() });
  const practice = viewFixture({
    gameScope: { kind: 'practice', gameInstanceId: 'practice', revision: 1 },
  });
  views.round(roundFixture({ phase: 'TEAM_PRACTICE' }));
  views.receive(practice);
  views.round(roundFixture({ phase: 'MAP_FINALIZING', stateVersion: 11 }));
  views.receive(
    viewFixture({
      stateVersion: 11,
      gameScope: { kind: 'none', gameInstanceId: null, revision: 2 },
      self: null,
      knownTerrain: [],
      knownActiveExits: [],
      visibleCells: [],
      visibleWallFaces: [],
    }),
  );
  views.round(roundFixture({ phase: 'GAME_LOADING', stateVersion: 12 }));
  views.receive(viewFixture({ stateVersion: 12 }));
  expect(views.receive({ ...practice, stateVersion: 13 })).toBe(false);
  expect(views.view?.gameScope.kind).toBe('game');
});
