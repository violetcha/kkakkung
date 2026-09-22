import { describe, expect, it } from 'vitest';

import {
  FUTURE_EVENT_QUEUE_LIMIT,
  FUTURE_EVENT_WAIT_MS,
  gameViewScopeSchema,
  privateEventSchema,
  completePrivateViewSchema,
  privateViewSchema,
  viewResyncSchema,
} from '../src/game-messages/events.js';
import { audioPolicySchema, mediaBindingsSchema } from '../src/game-messages/media.js';

const gameScope = { gameInstanceId: 'game-1', kind: 'game', revision: 3 } as const;
const marker = {
  matchId: 'match-1',
  gameScope,
  eventId: 'marker-1',
  tick: 150,
  stateVersion: 40,
  type: 'HUNTER_MARKER',
  payload: {
    markerId: 'mk',
    kind: 'sensor',
    point: { x: 2.5, y: 2 },
    occurredTick: 150,
    showAtTick: 150,
    expiresTick: 190,
  },
};

describe('private events and views', () => {
  it('keeps the future-event queue policy constants', () => {
    expect(FUTURE_EVENT_QUEUE_LIMIT).toBe(64);
    expect(FUTURE_EVENT_WAIT_MS).toBe(1000);
  });

  it('accepts active scopes on events and rejects the none scope', () => {
    expect(privateEventSchema.parse(marker)).toEqual(marker);
    expect(
      privateEventSchema.safeParse({
        ...marker,
        gameScope: { gameInstanceId: null, kind: 'none', revision: 2 },
      }).success,
    ).toBe(false);
    expect(
      privateEventSchema.safeParse({ ...marker, type: 'ITEM_PICKED', payload: {} }).success,
    ).toBe(false);
    expect(
      privateEventSchema.safeParse({
        ...marker,
        payload: { ...marker.payload, point: { x: 40, y: 2 } },
      }).success,
    ).toBe(false);
    expect(
      gameViewScopeSchema.parse({ gameInstanceId: null, kind: 'none', revision: 0 }).kind,
    ).toBe('none');
    expect(
      gameViewScopeSchema.safeParse({ gameInstanceId: 'x', kind: 'none', revision: 0 }).success,
    ).toBe(false);
  });

  it('requires wall on visible sensors and forbids wall on traps', () => {
    const view = {
      mapVersion: 1,
      knowledgeRevision: 3,
      knownTerrain: [
        { x: 1, y: 1, kind: 'floor' },
        { x: 1, y: 0, side: 2, kind: 'wall' },
      ],
      knownActiveExits: [],
      matchId: 'match-1',
      gameScope,
      stateVersion: 40,
      self: null,
      visibleCells: [{ x: 1, y: 1 }],
      visibleWallFaces: [{ x: 1, y: 0, side: 2 }],
      visibleEntities: [
        {
          id: 's1',
          kind: 'sensor',
          cell: { x: 10, y: 10 },
          wall: { x: 10, y: 9, side: 2 },
          state: 'ARMED',
        },
        { id: 't1', kind: 'trap', cell: { x: 4, y: 4 }, state: 'UNARMED' },
        { id: 'p2', kind: 'player', cell: { x: 5, y: 5 }, dir: 1, action: null, role: 'runner' },
      ],
    };
    expect(privateViewSchema.parse(view)).toEqual(view);
    expect(
      privateViewSchema.safeParse({
        ...view,
        visibleEntities: [{ id: 's1', kind: 'sensor', cell: { x: 10, y: 10 }, state: 'ARMED' }],
      }).success,
    ).toBe(false);
    expect(
      privateViewSchema.safeParse({
        ...view,
        visibleEntities: [
          {
            id: 't1',
            kind: 'trap',
            cell: { x: 4, y: 4 },
            wall: { x: 4, y: 3, side: 2 },
            state: 'ARMED',
          },
        ],
      }).success,
    ).toBe(false);
    expect(privateViewSchema.safeParse({ ...view, maze: [] }).success).toBe(false);
    expect(
      privateViewSchema.safeParse({
        ...view,
        self: { playerId: 'p', role: 'runner', status: 'ESCAPED' },
      }).success,
    ).toBe(true);
    // S15P21C204-326. The wire form may leave the accumulated knowledge off, but never the
    // revision that says which knowledge the view belongs to.
    const omitted: Record<string, unknown> = { ...view };
    delete omitted.knownTerrain;
    delete omitted.knownActiveExits;
    expect(privateViewSchema.safeParse(omitted).success).toBe(true);
    expect(privateViewSchema.parse(omitted)).not.toHaveProperty('knownTerrain');
    const revisionless: Record<string, unknown> = { ...view };
    delete revisionless.knowledgeRevision;
    expect(privateViewSchema.safeParse(revisionless).success).toBe(false);
    // The shape a recipient ends up holding is the other way round.
    expect(completePrivateViewSchema.safeParse(omitted).success).toBe(false);
    expect(completePrivateViewSchema.safeParse(revisionless).success).toBe(true);
    expect(completePrivateViewSchema.safeParse(view).success).toBe(false);
  });

  it('validates resync and media channel shapes', () => {
    expect(viewResyncSchema.parse({ matchId: 'm', lastStateVersion: 3 })).toEqual({
      matchId: 'm',
      lastStateVersion: 3,
    });
    expect(viewResyncSchema.safeParse({ matchId: 'm', lastStateVersion: -1 }).success).toBe(false);
    const bindings = {
      matchId: 'm',
      mediaInstanceId: 'mi',
      receiverGeneration: 1,
      bindingRevision: 8,
      participants: [
        {
          playerId: 'p1',
          publisherGeneration: 1,
          mediaIdentity: 'id',
          participantSid: 'PA',
          faceTrackSid: 'TR',
        },
      ],
    };
    expect(mediaBindingsSchema.parse(bindings)).toEqual(bindings);
    expect(
      mediaBindingsSchema.safeParse({
        ...bindings,
        participants: [{ ...bindings.participants[0], nickname: 'x' }],
      }).success,
    ).toBe(false);
    const policy = {
      ...bindings,
      policyRevision: 4,
      stateVersion: 40,
      voices: [],
      effects: [],
    } as Record<string, unknown>;
    delete policy.participants;
    expect(audioPolicySchema.parse(policy)).toBeTruthy();
    expect(
      audioPolicySchema.safeParse({
        ...policy,
        voices: [{ playerId: 'p', trackSid: 't', gain: 2, azimuthRad: 0, lowpassHz: 1 }],
      }).success,
    ).toBe(false);
  });
});
