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
