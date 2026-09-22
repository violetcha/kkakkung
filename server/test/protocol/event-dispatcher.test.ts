import { describe, expect, it } from 'vitest';
import type {
  CommandOutcome,
  PrivateEvent,
  RequestStatusResult,
} from '@kkakkung/protocol/game-messages';
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import {
  EMPTY_VIEW_BODY,
  EventDispatcher,
  type PrivateViewBody,
} from '../../src/game/EventDispatcher.js';
import { MatchContext } from '../../src/game/MatchContext.js';
import type { AudienceEvent } from '../../src/game/ports.js';
import { fakeClock } from '../room/test-harness.js';

function setup() {
  const clock = fakeClock(0);
  const context = new MatchContext({ serverEpoch: 'e', matchId: 'match-1' });
  const views: { playerId: string; view: PrivateView }[] = [];
  const events: { playerId: string; event: PrivateEvent }[] = [];
  const outcomes: { playerId: string; outcome: CommandOutcome }[] = [];
  const statuses: { playerId: string; status: RequestStatusResult }[] = [];
  const bodies = new Map<string, PrivateViewBody>();
  const dispatcher = new EventDispatcher({
    context,
    now: clock.now,
    sender: {
      sendView: (playerId, view) => views.push({ playerId, view }),
      sendEvent: (playerId, event) => events.push({ playerId, event }),
      sendOutcome: (playerId, outcome) => outcomes.push({ playerId, outcome }),
      sendStatus: (playerId, status) => statuses.push({ playerId, status }),
    },
    viewBody: (playerId) => bodies.get(playerId) ?? null,
  });
  return { clock, context, views, events, outcomes, statuses, bodies, dispatcher };
}

const body = (x: number): PrivateViewBody => ({
  ...EMPTY_VIEW_BODY,
  mapVersion: 1,
  knownTerrain: [{ x, y: 1, kind: 'floor' }],
  self: {
    playerId: 'r1',
    role: 'runner',
    status: 'ACTIVE',
    cell: { x, y: 1 },
    dir: 0,
    action: null,
    equipment: { sensor: 0, trap: 0 },
    ownedEquipment: [],
    restraintUntilTick: null,
    restraintImmuneUntilTick: null,
    installation: null,
    exchange: null,
    challenge: null,
    loading: null,
  },
  visibleCells: [{ x, y: 1 }],
});

describe('EventDispatcher', () => {
  it('sends full views on initial/scope/phase/resync and only on content change otherwise', () => {
    const h = setup();
    const practice = h.context.createInstance('practice', 'runner');
    h.dispatcher.publishView('r1', 'initial', 'LOBBY');
    expect(h.views.at(-1)?.view).toMatchObject({
      gameScope: { kind: 'none', revision: 0 },
      self: null,
      knownTerrain: [],
    });
    h.context.enterInstance('r1', practice.gameInstanceId);
    h.bodies.set('r1', body(2));
    h.dispatcher.publishView('r1', 'scope', 'TEAM_PRACTICE');
    const scoped = h.views.at(-1)!.view;
    expect(scoped.gameScope).toEqual({
      gameInstanceId: practice.gameInstanceId,
      kind: 'practice',
      revision: 1,
    });
    expect(scoped.stateVersion).toBeGreaterThan(0);
    const count = h.views.length;
    expect(h.dispatcher.publishView('r1', 'change', 'TEAM_PRACTICE')).toBeNull();
    expect(h.views).toHaveLength(count);
    h.bodies.set('r1', body(3));
    const changed = h.dispatcher.publishView('r1', 'change', 'TEAM_PRACTICE');
    expect(changed?.stateVersion).toBeGreaterThan(scoped.stateVersion);
    expect(h.dispatcher.applicableVersion('r1')).toBe(changed!.stateVersion);
    // Phase change resends the same content once at the (already bumped) transition version.
    h.context.bumpVersion();
    const phase = h.dispatcher.publishView('r1', 'phase', 'MAP_FINALIZING');
    expect(phase?.stateVersion).toBe(h.context.stateVersion);
    expect(phase?.knownTerrain).toEqual(changed?.knownTerrain);
    // Leaving the instance sends the empty none view with a higher revision.
    h.context.leaveInstance('r1');
    const none = h.dispatcher.publishView('r1', 'scope', 'MAP_FINALIZING');
    expect(none).toMatchObject({
      gameScope: { gameInstanceId: null, kind: 'none', revision: 2 },
      self: null,
      visibleCells: [],
      knownTerrain: [],
    });
  });

  it('compares view content structurally: a rebuilt identical body never resends, deep edits do', () => {
    const h = setup();
    const instance = h.context.createInstance('game');
    h.context.enterInstance('r1', instance.gameInstanceId);
    h.bodies.set('r1', body(2));
    h.dispatcher.publishView('r1', 'initial', 'PLAYING');
    const sent = () => h.views.length;
    const afterInitial = sent();

    // The projection builds a new object every tick. Identical content is not a change.
    h.bodies.set('r1', body(2));
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')).toBeNull();
    h.bodies.set('r1', body(2));
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')).toBeNull();
    expect(sent()).toBe(afterInitial);

    // A value nested inside an array element is a change.
    const deep = { ...body(2), knownTerrain: [{ x: 2, y: 9, kind: 'floor' as const }] };
    h.bodies.set('r1', deep);
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')).not.toBeNull();
    h.bodies.set('r1', { ...deep, knownTerrain: [{ x: 2, y: 9, kind: 'floor' as const }] });
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')).toBeNull();

    // Array length is a change.
    const longer = {
      ...deep,
      visibleCells: [
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ],
    };
    h.bodies.set('r1', longer);
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')).not.toBeNull();

    // Order inside an array is a change: the same cells in a different order still resend.
    h.bodies.set('r1', {
      ...longer,
      visibleCells: [
        { x: 3, y: 1 },
        { x: 2, y: 1 },
      ],
    });
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')).not.toBeNull();

    // Dropping a nested object entirely is a change.
    h.bodies.set('r1', {
      ...longer,
      visibleCells: [
        { x: 3, y: 1 },
        { x: 2, y: 1 },
      ],
      self: null,
    });
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')).not.toBeNull();
    // Every view that went out carries a strictly newer version than the one before it.
    const versions = h.views.map((entry) => entry.view.stateVersion);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  // S15P21C204-326. The accumulated knowledge is 87% of a view's bytes and changes in 2.5% of
  // the views that go out, so a view that would repeat it leaves it off.
  it('leaves unchanged knowledge off a change view and always carries it on every other reason', () => {
    const h = setup();
    const instance = h.context.createInstance('game');
    h.context.enterInstance('r1', instance.gameInstanceId);
    h.bodies.set('r1', body(2));
    const first = h.dispatcher.publishView('r1', 'initial', 'PLAYING')!;
    expect(first.knownTerrain).toEqual([{ x: 2, y: 1, kind: 'floor' }]);
    expect(first.knownActiveExits).toEqual([]);
    expect(first.knowledgeRevision).toBe(1);

    // Walking changes `self` and sight but not the memory: the memory does not go out again.
    h.bodies.set('r1', { ...body(3), knownTerrain: body(2).knownTerrain });
    const moved = h.dispatcher.publishView('r1', 'change', 'PLAYING')!;
    expect(moved.knownTerrain).toBeUndefined();
    expect(moved.knownActiveExits).toBeUndefined();
    expect(moved.knowledgeRevision).toBe(1);
    expect('knownTerrain' in moved).toBe(false);

    // Seeing a new cell moves the revision and puts the whole pair back on the wire.
    const grown = [...body(2).knownTerrain, { x: 9, y: 9, kind: 'floor' as const }];
    h.bodies.set('r1', { ...body(3), knownTerrain: grown });
    const discovered = h.dispatcher.publishView('r1', 'change', 'PLAYING')!;
    expect(discovered.knownTerrain).toEqual(grown);
    expect(discovered.knowledgeRevision).toBe(2);

    // Every reason but `change` is a moment the recipient may have just dropped what it held.
    for (const reason of ['initial', 'scope', 'phase', 'resync'] as const) {
      h.context.bumpVersion();
      const forced = h.dispatcher.publishView('r1', reason, 'PLAYING')!;
      expect(forced.knownTerrain, reason).toEqual(grown);
      expect(forced.knownActiveExits, reason).toEqual([]);
      // Repeating the pair is not a change to it: the revision stays where it was.
      expect(forced.knowledgeRevision, reason).toBe(2);
    }

    // Exits are knowledge too, and they move the same revision.
    h.bodies.set('r1', {
      ...body(3),
      knownTerrain: grown,
      knownActiveExits: [
        { exitId: 'e', ownerId: 'r1', wall: { x: 1, y: 0, side: 2 }, approach: { x: 1, y: 1 } },
      ],
    });
    const withExit = h.dispatcher.publishView('r1', 'change', 'PLAYING')!;
    expect(withExit.knownActiveExits).toHaveLength(1);
    expect(withExit.knownTerrain).toEqual(grown);
    expect(withExit.knowledgeRevision).toBe(3);
  });

  it('gives each recipient its own revision and never reuses one across matches', () => {
    const h = setup();
    const instance = h.context.createInstance('game');
    for (const id of ['r1', 'r2']) h.context.enterInstance(id, instance.gameInstanceId);
    h.bodies.set('r1', body(2));
    h.bodies.set('r2', body(5));
    expect(h.dispatcher.publishView('r1', 'initial', 'PLAYING')?.knowledgeRevision).toBe(1);
    expect(h.dispatcher.publishView('r2', 'initial', 'PLAYING')?.knowledgeRevision).toBe(1);
    // r1 discovers a cell; r2's revision must not move with it.
    h.bodies.set('r1', { ...body(2), knownTerrain: [{ x: 7, y: 7, kind: 'floor' }] });
    expect(h.dispatcher.publishView('r1', 'change', 'PLAYING')?.knowledgeRevision).toBe(2);
    h.bodies.set('r2', { ...body(5), visibleCells: [{ x: 5, y: 2 }] });
    const r2 = h.dispatcher.publishView('r2', 'change', 'PLAYING')!;
    expect(r2.knowledgeRevision).toBe(1);
    expect(r2.knownTerrain).toBeUndefined();
    // A rematch clears what was delivered, so the next view starts a fresh revision in full.
    h.dispatcher.resetForMatch();
    const fresh = h.dispatcher.publishView('r1', 'initial', 'PLAYING')!;
    expect(fresh.knowledgeRevision).toBe(1);
    expect(fresh.knownTerrain).toEqual([{ x: 7, y: 7, kind: 'floor' }]);
  });

  it('delivers events only to recipients scoped to the producing instance with their current scope', () => {
    const h = setup();
    const practice = h.context.createInstance('practice', 'runner');
    const game = h.context.createInstance('game');
    h.context.enterInstance('r1', practice.gameInstanceId);
    h.context.enterInstance('t1', game.gameInstanceId);
    const event: AudienceEvent = {
      eventId: 'evt-1',
      tick: 10,
      audience: ['r1', 't1', 'ghost'],
      type: 'EXCHANGE_OFFER',
      payload: { exchangeId: 'x', fromPlayerId: 'r2', expiresAtTick: 50 },
    };
    expect(h.dispatcher.dispatchEvent(event, practice.gameInstanceId)).toBe(1);
    expect(h.events).toEqual([
      {
        playerId: 'r1',
        event: expect.objectContaining({
          eventId: 'evt-1',
          gameScope: { gameInstanceId: practice.gameInstanceId, kind: 'practice', revision: 1 },
          matchId: 'match-1',
        }),
      },
    ]);
    // A late practice event after r1 moved on is not re-labelled to the game scope.
    h.context.leaveInstance('r1');
    h.context.enterInstance('r1', game.gameInstanceId);
    expect(h.dispatcher.dispatchEvent(event, practice.gameInstanceId)).toBe(0);
  });

  it('rate limits resync, rejects other matches and re-serializes at the current version', () => {
    const h = setup();
    h.bodies.set('r1', body(1));
    const game = h.context.createInstance('game');
    h.context.enterInstance('r1', game.gameInstanceId);
    h.dispatcher.publishView('r1', 'initial', 'GAME_LOADING');
    expect(
      h.dispatcher.handleResync('r1', { matchId: 'other', lastStateVersion: 0 }, 'GAME_LOADING'),
    ).toBe('rejected');
    expect(
      h.dispatcher.handleResync(
        'r1',
        { matchId: 'match-1', lastStateVersion: 0, extra: 1 },
        'GAME_LOADING',
      ),
    ).toBe('rejected');
    h.context.bumpVersion();
    h.context.bumpVersion();
    expect(
      h.dispatcher.handleResync('r1', { matchId: 'match-1', lastStateVersion: 0 }, 'GAME_LOADING'),
    ).toBe('sent');
    expect(h.views.at(-1)?.view.stateVersion).toBe(h.context.stateVersion);
    h.clock.advance(500);
    expect(
      h.dispatcher.handleResync('r1', { matchId: 'match-1', lastStateVersion: 0 }, 'GAME_LOADING'),
    ).toBe('limited');
    h.clock.advance(500);
    expect(
      h.dispatcher.handleResync('r1', { matchId: 'match-1', lastStateVersion: 0 }, 'GAME_LOADING'),
    ).toBe('sent');
  });
});
