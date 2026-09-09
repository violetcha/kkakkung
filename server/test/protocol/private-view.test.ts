import { describe, expect, it } from 'vitest';
import { privateViewSchema } from '@kkakkung/protocol/game-messages';
import { projectPrivateBody, projectVisibleEntities } from '../../src/game/PlayerProjection.js';
import { FakeCore, layoutFor, testTuning } from '../room/test-harness.js';

const players = [
  { playerId: 'r1', role: 'runner' as const },
  { playerId: 'r2', role: 'runner' as const },
  { playerId: 't1', role: 'tagger' as const },
];

function match() {
  const core = new FakeCore();
  const layout = layoutFor(players);
  let state = core.createMatch({
    matchId: 'm',
    gameInstanceId: 'g',
    seed: 1,
    tuning: testTuning,
    layout,
    players,
  });
  state = core.stepMatch(state, {
    tick: 1,
    commands: [],
    controls: [{ type: 'START_PLAYING', startTick: 1 }],
  }).state;
  return { core, state, layout };
}

describe('private view projection (allowlist)', () => {
  it('gives runners their own exits, taggers none, and never the whole map or other players', () => {
    const { core, state } = match();
    const runner = projectPrivateBody(core, state, 'r1', null);
    const tagger = projectPrivateBody(core, state, 't1', null);
    expect(runner.knownActiveExits.map((e) => e.ownerId)).toEqual(['r1']);
    expect(tagger.knownActiveExits).toEqual([]);
    expect(runner.knownTerrain).toHaveLength(1);
    expect(runner.visibleEntities.map((e) => e.id)).not.toContain('t1');
    expect(
      privateViewSchema.safeParse({
        ...runner,
        matchId: 'm',
        gameScope: { gameInstanceId: 'g', kind: 'game', revision: 1 },
        stateVersion: 1,
      }).success,
    ).toBe(true);
    const json = JSON.stringify(runner);
    for (const forbidden of ['maze', 'seed', 'tuning', 'topology', 'walkable', 'nickname'])
      expect(json).not.toContain(forbidden);
  });

  it('exposes only allied role markers and requires a wall face on visible sensors', () => {
    const entities = projectVisibleEntities(
      [
        { id: 'ally', kind: 'player', cell: { x: 1, y: 1 }, dir: 0, action: null, role: 'runner' },
        { id: 'enemy', kind: 'player', cell: { x: 2, y: 1 }, dir: 0, action: null, role: 'tagger' },
        {
          id: 's',
          kind: 'sensor',
          cell: { x: 3, y: 1 },
          wall: { x: 3, y: 0, side: 2 },
          state: 'ARMED',
        },
        { id: 'broken', kind: 'sensor', cell: { x: 4, y: 1 }, state: 'ARMED' } as never,
        { id: 'trap', kind: 'trap', cell: { x: 5, y: 1 }, state: 'UNARMED' },
      ],
      'runner',
    );
    expect(entities).toEqual([
      { id: 'ally', kind: 'player', cell: { x: 1, y: 1 }, dir: 0, action: null, role: 'runner' },
      { id: 'enemy', kind: 'player', cell: { x: 2, y: 1 }, dir: 0, action: null },
      {
        id: 's',
        kind: 'sensor',
        cell: { x: 3, y: 1 },
        wall: { x: 3, y: 0, side: 2 },
        state: 'ARMED',
      },
      { id: 'trap', kind: 'trap', cell: { x: 5, y: 1 }, state: 'UNARMED' },
    ]);
  });

  it("shows another tagger's sensor with its wall but not the owner's full equipment list", () => {
    const { core, layout } = match();
    const taggers = [
      { playerId: 't1', role: 'tagger' as const },
      { playerId: 't2', role: 'tagger' as const },
    ];
    let state = core.createMatch({
      matchId: 'm',
      gameInstanceId: 'g2',
      seed: 1,
      tuning: testTuning,
      layout: layoutFor(taggers, layout.topology),
      players: taggers,
    });
    state = core.stepMatch(state, {
      tick: 1,
      commands: [],
      controls: [{ type: 'START_PLAYING', startTick: 1 }],
    }).state;
    state = core.stepMatch(state, {
      tick: 2,
      commands: [
        {
          matchId: 'm',
          requestId: '30000000-0000-4000-8000-000000000009',
          sequence: 1,
          type: 'INSTALL',
          payload: { kind: 'sensor' },
          actorId: 't1',
        },
      ],
      controls: [],
    }).state;
    // Move t2 next to t1 so the sensor is observable.
    const t2 = state.players.get('t2')!;
    t2.cell = { ...state.players.get('t1')!.cell, x: state.players.get('t1')!.cell.x + 1 };
    const observer = projectPrivateBody(core, state, 't2', null);
    const sensor = observer.visibleEntities.find((e) => e.kind === 'sensor');
    expect(sensor).toMatchObject({ kind: 'sensor', wall: { side: 2 } });
    expect(
      observer.self && observer.self.status === 'ACTIVE' ? observer.self.ownedEquipment : [],
    ).toEqual([]);
    const owner = projectPrivateBody(core, state, 't1', null);
    expect(
      owner.self && owner.self.status === 'ACTIVE' ? owner.self.ownedEquipment : [],
    ).toHaveLength(1);
  });

  it('reduces an ended player to a minimal self with no terrain, entities or surfaces', () => {
    const { core, state } = match();
    state.players.get('r2')!.status = 'ESCAPED';
    const ended = projectPrivateBody(core, state, 'r2', null);
    expect(ended).toEqual({
      mapVersion: 0,
      knownTerrain: [],
      knownActiveExits: [],
      self: { playerId: 'r2', role: 'runner', status: 'ESCAPED' },
      visibleCells: [],
      visibleWallFaces: [],
      visibleEntities: [],
    });
  });

  it('attaches the server-owned loading view and computes exchange direction for the recipient', () => {
    const { core, state } = match();
    const loading = {
      loadId: 'load-1',
      initialViewVersion: 4,
      mediaInstanceId: 'media-1',
      receiverGeneration: 1,
      assetVersion: 'assets-test-1',
    };
    const view = projectPrivateBody(core, state, 'r1', loading);
    expect(view.self && view.self.status === 'ACTIVE' ? view.self.loading : null).toEqual(loading);
  });
});
