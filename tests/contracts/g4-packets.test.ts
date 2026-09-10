// F-13 / QA-08 G4 recipient boundary on real modules: A `matchCore` → B `projectPrivateBody` and
// `EventDispatcher` → protocol private view / private event / public round state, recorded per
// recipient. Taggers never learn exits, nobody learns unexplored terrain or out-of-sight
// coordinates, ended players receive nothing new, and past events reach the hunters as one fixed
// point instead of a position feed. No socket, no Cloud, no browser bundle here (g4-bundle covers it).
import { describe, expect, it } from 'vitest';
import { PUBLIC_MATCH_STATE_FIELDS } from '@kkakkung/protocol/game-schema';
import { activeExits } from '@kkakkung/game-core/match';
import { G3_TUNING } from '../fixtures/g3-scenarios.ts';
import {
  EXCHANGE_PLACEMENTS,
  SENTINELS,
  allowedCells,
  coordinatesIn,
  coordinatesOutsideSight,
  createViewHarness,
  parseEvent,
  parseView,
  type ViewHarness,
} from '../fixtures/private-view-scenarios.ts';

const MOVE = G3_TUNING.moveTicks;
const TAGGERS = ['t1', 't2', 't3'];
const RUNNERS = ['r1', 'r2', 'r3'];
const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
const exitCells = SENTINELS.exits.flatMap((e) => [key(e.wall), key(e.approach)]);

/** Every delivered view of one recipient, parsed against the strict wire schema. */
function deliveredViews(v: ViewHarness, id: string) {
  return v.viewsOf(id).map(parseView);
}

describe('taggers: exits, unexplored terrain and out-of-sight coordinates never leave the server', () => {
  it('initial view, every change and a resync carry no exit sentinel and no coordinate outside sight or memory', () => {
    const v = createViewHarness();
    v.h.start();
    v.publish('initial');
    // t1 walks north toward the runners for a while; views are published after every tick.
    v.h.move('t1');
    v.tickAndPublish(MOVE + 1);
    v.h.stop('t1');
    v.tickAndPublish(3);
    for (const id of TAGGERS) {
      const views = deliveredViews(v, id);
      expect(views.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const view of views) {
        expect(view.knownActiveExits).toEqual([]);
        const raw = JSON.stringify(view);
        expect(raw).not.toMatch(/exit-r|poseKind|"seed"|"layout"|"topology"|g3-layout|g3-topology/);
        // Memory may only contain what a delivered view has shown before (plus what it shows now).
        for (const c of view.visibleCells) seen.add(key(c));
        for (const w of view.visibleWallFaces) seen.add(key(w));
        for (const t of view.knownTerrain)
          expect(seen.has(key(t)), `${id} unexplored ${key(t)}`).toBe(true);
        expect(coordinatesOutsideSight(view)).toEqual([]);
        // Enemy roles are not labelled; only an allied tagger may carry a role marker.
        for (const e of view.visibleEntities)
          if (e.kind === 'player' && 'role' in e) expect(e.role).toBe('tagger');
      }
    }
    // A tagger never sees an exit wall cell as terrain it "knows" is an exit: the wall may be
    // known as a plain wall face, the approach as a plain floor cell, nothing more.
    const t1 = parseView(v.latestView('t1'));
    expect(JSON.stringify(t1)).not.toContain('"exitId"');
    // Resync re-serializes the same content at the current version; nothing extra is attached.
    expect(
      v.dispatcher.handleResync(
        't1',
        { matchId: v.h.context.matchId, lastStateVersion: 0 },
        'PLAYING',
      ),
    ).toBe('sent');
    const resynced = parseView(v.latestView('t1'));
    const { stateVersion: a, ...bodyA } = t1;
    const { stateVersion: b, ...bodyB } = resynced;
    expect(bodyB).toEqual(bodyA);
    expect(b).toBeGreaterThanOrEqual(a);
    // Exit cells of the runners are not among the tagger's coordinates unless they are in plain sight.
    const allowed = allowedCells(resynced);
    for (const c of coordinatesIn(resynced))
      if (exitCells.includes(key(c))) expect(allowed.has(key(c))).toBe(true);
  });

  it('a resync with a foreign match id or too often is refused, never answered with another view', () => {
    const v = createViewHarness();
    v.h.start();
    v.publish('initial');
    const before = v.viewsOf('t2').length;
    expect(
      v.dispatcher.handleResync('t2', { matchId: 'other', lastStateVersion: 0 }, 'PLAYING'),
    ).toBe('rejected');
    expect(v.dispatcher.handleResync('t2', { matchId: v.h.context.matchId }, 'PLAYING')).toBe(
      'rejected',
    );
    expect(
      v.dispatcher.handleResync(
        't2',
        { matchId: v.h.context.matchId, lastStateVersion: 0 },
        'PLAYING',
      ),
    ).toBe('sent');
    expect(
      v.dispatcher.handleResync(
        't2',
        { matchId: v.h.context.matchId, lastStateVersion: 0 },
        'PLAYING',
      ),
    ).toBe('limited');
    expect(v.viewsOf('t2').length).toBe(before + 1);
  });
});

describe('runners: only discovered, still-active exits; nothing of the others before an exchange', () => {
  it('r1 learns its own exit by seeing the wall face; r2 and r3 keep none, and no view carries poseKind', () => {
    const v = createViewHarness();
    v.h.start();
    v.publish('initial');
    // From (5,6) facing north the south face of (5,2) is exactly 3.5 cells away: r1 sees its own
    // exit from the first tick, and it is the only one it will ever know without an exchange.
    expect(parseView(v.latestView('r1')).knownActiveExits.map((e) => e.exitId)).toEqual([
      'exit-r1',
    ]);
    v.h.walk('r1', 3);
    v.publish('change');
    const r1 = parseView(v.latestView('r1'));
    expect(r1.knownActiveExits).toEqual([
      expect.objectContaining({
        exitId: 'exit-r1',
        ownerId: 'r1',
        wall: { x: 5, y: 2, side: 2 },
        approach: { x: 5, y: 3 },
      }),
    ]);
    expect(JSON.stringify(r1)).not.toContain('poseKind');
    for (const id of ['r2', 'r3']) {
      const view = parseView(v.latestView(id));
      expect(view.knownActiveExits).toEqual([]);
      expect(JSON.stringify(view)).not.toMatch(/exit-r1|exit-r2|exit-r3/);
      expect(coordinatesOutsideSight(view)).toEqual([]);
    }
  });
});

describe('ended players receive nothing new', () => {
  it('after a capture the ended runner gets one minimal view and no further views or events while survivors move; its exit closes', () => {
    const v = createViewHarness();
    v.h.start();
    v.publish('initial');
    v.h.move('t1');
    v.tickAndPublish(MOVE + 1);
    expect(v.h.player('r1').status).toBe('CAPTURED');
    const ended = parseView(v.latestView('r1'));
    expect(ended.self).toEqual({ playerId: 'r1', role: 'runner', status: 'CAPTURED' });
    expect(ended.knownTerrain).toEqual([]);
    expect(ended.visibleEntities).toEqual([]);
    expect(ended.knownActiveExits).toEqual([]);
    expect(coordinatesIn(ended)).toEqual([]);
    const viewsBefore = v.viewsOf('r1').length;
    const eventsBefore = v.eventsOf('r1').length;
    // t1 keeps moving right next to the ended runner; r2 walks too.
    v.h.stop('t1');
    v.tickAndPublish(1);
    v.h.face('t1', 'right');
    v.publish('change');
    v.h.move('t1');
    v.h.move('r2');
    v.tickAndPublish(MOVE + 2);
    expect(v.viewsOf('r1').length).toBe(viewsBefore);
    expect(v.eventsOf('r1').length).toBe(eventsBefore);
    expect(v.publish('change').get('r1')).toBeNull();
    // The closed exit is gone from the authoritative active set and from the media frames' ACTIVE roster.
    expect(
      activeExits(v.h.state().exits)
        .map((e) => e.ownerId)
        .sort(),
    ).toEqual(['r2', 'r3']);
    const lastFrame = v.h.frames.at(-1)!;
    expect(lastFrame.participants.find((p) => p.playerId === 'r1')?.status).toBe('CAPTURED');
  });
});

describe('past events: one fixed point for the hunters, no position feed', () => {
  it('a map exchange publishes a single midpoint marker 20 ticks later; the runners have moved on and stay out of the taggers’ views', () => {
    const v = createViewHarness({ placements: EXCHANGE_PLACEMENTS });
    v.h.start();
    v.publish('initial');
    expect(v.h.send('r1', 'EXCHANGE_REQUEST', { targetPlayerId: 'r2' })).toMatchObject({
      result: 'applied',
    });
    v.deliverEvents();
    const offer = v
      .eventsOf('r2')
      .map(parseEvent)
      .find((e) => e.type === 'EXCHANGE_OFFER');
    expect(offer).toBeDefined();
    expect(v.eventsOf('r1').map((e) => e.type)).not.toContain('EXCHANGE_OFFER');
    const exchangeId = (offer!.payload as { exchangeId: string }).exchangeId;
    expect(v.h.send('r2', 'EXCHANGE_ACCEPT', { exchangeId })).toMatchObject({ result: 'applied' });
    const occurredTick = v.h.state().tick!;
    v.deliverEvents();
    for (const id of ['r1', 'r2'])
      expect(
        v
          .eventsOf(id)
          .map(parseEvent)
          .some((e) => e.type === 'EXCHANGE_COMPLETED'),
      ).toBe(true);
    for (const id of TAGGERS) expect(v.eventsOf(id)).toEqual([]);
    // Both runners walk away from the exchange cell during the trace delay.
    v.h.move('r1', 'back');
    v.h.move('r2', 'back');
    v.tickAndPublish(MOVE);
    v.h.stop('r1');
    v.h.stop('r2');
    v.tickAndPublish(1);
    while (v.h.state().tick! < occurredTick + 20) v.tickAndPublish(1);
    expect(v.h.player('r1').cell).toEqual({ x: 3, y: 5 });
    expect(v.h.player('r2').cell).toEqual({ x: 6, y: 5 });
    for (const id of TAGGERS) {
      const markers = v
        .eventsOf(id)
        .map(parseEvent)
        .filter((e) => e.type === 'HUNTER_MARKER');
      expect(markers).toHaveLength(1);
      const payload = markers[0]!.payload as {
        kind: string;
        point: { x: number; y: number };
        occurredTick: number;
        showAtTick: number;
        expiresTick: number;
      };
      expect(payload).toEqual({
        markerId: expect.any(String),
        kind: 'exchange',
        point: { x: 4.5, y: 5 },
        occurredTick,
        showAtTick: occurredTick + 20,
        expiresTick: occurredTick + 60,
      });
      expect(JSON.stringify(payload)).not.toMatch(/r1|r2|playerId/);
      // The taggers' own views never contained the runners: the past point is the only information.
      for (const view of deliveredViews(v, id)) {
        expect(view.visibleEntities.filter((e) => e.kind === 'player').map((e) => e.id)).toEqual(
          [],
        );
        expect(coordinatesOutsideSight(view)).toEqual([]);
      }
    }
    for (const id of RUNNERS)
      expect(v.eventsOf(id).map((e) => e.type)).not.toContain('HUNTER_MARKER');
    // Twenty more ticks: the marker is not re-sent and no current position follows it.
    v.tickAndPublish(20);
    for (const id of TAGGERS)
      expect(v.eventsOf(id).filter((e) => e.type === 'HUNTER_MARKER')).toHaveLength(1);
  });
});

describe('public state and versioning', () => {
  it('the public round state has no coordinate field and private views advance stateVersion only on real change', () => {
    expect(
      PUBLIC_MATCH_STATE_FIELDS.some((f) => /^(x|y|cell|exit|dir|position|players)$/i.test(f)),
    ).toBe(false);
    const v = createViewHarness();
    v.h.start();
    v.publish('initial');
    const pub = v.publicState();
    expect(coordinatesIn(pub)).toEqual([]);
    expect(Object.keys(pub).sort()).toEqual(
      [...PUBLIC_MATCH_STATE_FIELDS].filter((f) => f !== 'protocolVersion').sort(),
    );
    // Idle ticks produce no view packets; a real change produces exactly one newer version.
    const before = v.viewsOf('t3').length;
    v.tickAndPublish(3);
    expect(v.viewsOf('t3').length).toBe(before);
    v.h.turn('t3', 'left');
    v.tickAndPublish(1);
    const versions = v.viewsOf('t3').map((x) => x.stateVersion);
    expect(versions.length).toBe(before + 1);
    for (let i = 1; i < versions.length; i++)
      expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
  });
});
