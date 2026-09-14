import { describe, expect, it } from 'vitest';

import type { CoreCommand, DomainEvent } from '../../src/match/core-types.js';
import {
  getFrame,
  getPlayerKnowledge,
  getPlayerSelf,
  getVisibleEntities,
  getVisibleSurfaces,
  stepMatch,
  type MatchState,
} from '../../src/match/engine.js';
import { exitOfOwner } from '../../src/match/exits/registry.js';
import { command as rawCommand, createTestMatch, player, roster, step } from './match-fixture.js';

/**
 * Command with fixed request identifiers. The fixture's own counter is module
 * global, so two runs of the same script must pin them to compare byte for byte.
 */
let scriptSeq = 0;
function command<K extends Parameters<typeof rawCommand>[1]>(
  actorId: string,
  type: K,
  payload: Parameters<typeof rawCommand<K>>[2],
): CoreCommand<K> {
  scriptSeq += 1;
  return rawCommand(actorId, type, payload, {
    requestId: `rq-${scriptSeq}`,
    sequence: scriptSeq,
  });
}

/** Places players on chosen cells/dirs without moving through the maze. */
function place(
  state: MatchState,
  placements: Record<string, { x: number; y: number; dir?: 0 | 1 | 2 | 3 }>,
): MatchState {
  const players = new Map(state.players);
  for (const [id, p] of Object.entries(placements)) {
    const record = player(state, id);
    players.set(id, {
      ...record,
      cell: { x: p.x, y: p.y },
      dir: p.dir ?? record.dir,
      action: null,
    });
  }
  return { ...state, players };
}

type Script = ReadonlyArray<Readonly<{ tick: number; commands?: readonly CoreCommand[] }>>;

/**
 * One scripted match that exercises every D2 rule: exchange request/accept,
 * sensor and trap activation, restraint, and an exit challenge to escape.
 * Commands are built fresh per run so request ids stay comparable by position.
 */
function scriptedRun(): Readonly<{
  states: readonly MatchState[];
  outcomes: readonly unknown[];
  events: readonly DomainEvent[];
  media: readonly unknown[];
}> {
  scriptSeq = 0;
  // Start a match, then place everyone for the scripted scenario.
  const base = stepMatch(createTestMatch({ seed: 11 }), {
    tick: 1,
    commands: [],
    controls: [{ type: 'START_PLAYING', startTick: 1 }],
  }).state;
  const exit = exitOfOwner(base.exits, 'r-a')!;
  let state = place(base, {
    // r-a and r-b next to each other for the map exchange.
    'r-a': { x: 10, y: 2, dir: 1 },
    'r-b': { x: 11, y: 2, dir: 3 },
    // r-c approaches the devices t-a installs on (5,3) and (5,4).
    'r-c': { x: 4, y: 3, dir: 1 },
    't-a': { x: 5, y: 3, dir: 1 },
    't-b': { x: 5, y: 4, dir: 1 },
  });
  const states: MatchState[] = [];
  const outcomes: unknown[] = [];
  const events: DomainEvent[] = [];
  const media: unknown[] = [];

  const script: Script = [
    // Devices: a sensor on (5,3) and a trap on (5,4), both complete at tick 20.
    { tick: 10, commands: [command('t-a', 'INSTALL', { kind: 'sensor' })] },
    { tick: 11, commands: [command('t-b', 'INSTALL', { kind: 'trap' })] },
    // Map exchange between r-a and r-b.
    { tick: 12, commands: [command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' })] },
    { tick: 13, commands: [command('r-b', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' })] },
    // A refused exchange (same knowledge now) and a refused install (no stock).
    { tick: 14, commands: [command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' })] },
    { tick: 15, commands: [command('t-a', 'INSTALL', { kind: 'sensor' })] },
  ];
  for (const line of script) {
    const result = stepMatch(state, {
      tick: line.tick,
      commands: line.commands ?? [],
      controls: [],
    });
    state = result.state;
    states.push(state);
    outcomes.push(...result.outcomes);
    events.push(...result.events);
    media.push(...result.mediaIntents);
  }
  // Idle to the arming tick, then move the installers away from their cells.
  for (let tick = 16; tick <= 40; tick += 1) {
    const result = stepMatch(state, { tick, commands: [], controls: [] });
    state = result.state;
    events.push(...result.events);
    outcomes.push(...result.outcomes);
    if (tick === 30) {
      state = place(state, { 't-a': { x: 8, y: 16, dir: 0 }, 't-b': { x: 25, y: 16, dir: 0 } });
    }
  }
  // r-c walks onto the sensor cell (5,3): the sensor fires.
  const walk = (tick: number, commands: readonly CoreCommand[] = []) => {
    const result = stepMatch(state, { tick, commands, controls: [] });
    state = result.state;
    states.push(state);
    outcomes.push(...result.outcomes);
    events.push(...result.events);
    media.push(...result.mediaIntents);
  };
  walk(41, [command('r-c', 'MOVE_INTENT', { direction: 'forward' })]);
  for (let tick = 42; tick <= 50; tick += 1) walk(tick);
  // Turn south and step onto the trap cell (5,4): the trap restrains r-c.
  walk(51, [
    command('r-c', 'MOVE_INTENT', { direction: null }),
    command('r-c', 'TURN', { direction: 'right' }),
  ]);
  for (let tick = 52; tick <= 60; tick += 1) walk(tick);
  walk(61, [command('r-c', 'MOVE_INTENT', { direction: 'forward' })]);
  for (let tick = 62; tick <= 75; tick += 1) walk(tick);
  // Refused move while restrained, allowed turn.
  walk(76, [
    command('r-c', 'MOVE_INTENT', { direction: 'forward' }),
    command('r-c', 'TURN', { direction: 'left' }),
  ]);
  for (let tick = 77; tick <= 110; tick += 1) walk(tick);

  // r-a poses at its own exit and escapes.
  state = place(state, { 'r-a': { x: exit.approach.x, y: exit.approach.y, dir: 1 } });
  walk(111, [command('r-a', 'EXIT_START', { exitId: exit.exitId })]);
  walk(120, [
    command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
  ]);
  walk(151, [
    command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
  ]);
  return { states, outcomes, events, media };
}

/** Every field a projection or event payload is allowed to carry. */
const ALLOWED = {
  selfActive: [
    'action',
    'cell',
    'challenge',
    'dir',
    'equipment',
    'exchange',
    'installation',
    'loading',
    'ownedEquipment',
    'playerId',
    'restraintImmuneUntilTick',
    'restraintUntilTick',
    'role',
    'status',
  ],
  selfEnded: ['playerId', 'role', 'status'],
  knowledge: ['knownActiveExits', 'knownTerrain', 'mapVersion'],
  knownExit: ['approach', 'exitId', 'ownerId', 'wall'],
  frame: [
    'abortReason',
    'counts',
    'gameInstanceId',
    'matchId',
    'participants',
    'phase',
    'result',
    'tick',
  ],
  subject: ['action', 'cell', 'dir', 'playerId', 'role', 'status'],
  entityPlayer: ['action', 'cell', 'dir', 'id', 'kind', 'role'],
  entitySensor: ['cell', 'id', 'kind', 'state', 'wall'],
  entityTrap: ['cell', 'id', 'kind', 'state'],
  event: ['audience', 'eventId', 'payload', 'tick', 'type'],
  payloads: {
    EXCHANGE_OFFER: ['exchangeId', 'expiresAtTick', 'fromPlayerId'],
    EXCHANGE_CANCELED: ['exchangeId', 'reason'],
    EXCHANGE_COMPLETED: ['exchangeId', 'mapVersion'],
    HUNTER_MARKER: ['expiresTick', 'kind', 'markerId', 'occurredTick', 'point', 'showAtTick'],
    EXIT_CHALLENGE: [
      'challengeId',
      'exitId',
      'expiresAtTick',
      'minSuccessTick',
      'poseKind',
      'startedAtTick',
    ],
    EXIT_CHALLENGE_ENDED: ['challengeId', 'reason', 'result'],
  } as Record<string, readonly string[]>,
  sound: ['cell', 'eventId', 'kind', 'sourcePlayerId', 'tick'],
  outcome: ['actorId', 'code', 'matchId', 'requestId', 'result', 'sequence', 'tick'],
};

function keysOf(value: unknown): string[] {
  return Object.keys(value as object).sort();
}

function within(actual: readonly string[], allowed: readonly string[]): boolean {
  return actual.every((key) => allowed.includes(key));
}

describe('A rule engine self-audit', () => {
  it('produces byte-identical results for the same seed and the same command script', () => {
    const first = scriptedRun();
    const second = scriptedRun();
    expect(JSON.stringify(second.outcomes)).toBe(JSON.stringify(first.outcomes));
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(JSON.stringify(second.media)).toBe(JSON.stringify(first.media));
    // Frames, self projections and knowledge match at every scripted step.
    expect(first.states.length).toBe(second.states.length);
    for (let i = 0; i < first.states.length; i += 1) {
      const a = first.states[i]!;
      const b = second.states[i]!;
      expect(JSON.stringify(getFrame(b))).toBe(JSON.stringify(getFrame(a)));
      for (const entry of roster) {
        expect(JSON.stringify(getPlayerSelf(b, entry.playerId))).toBe(
          JSON.stringify(getPlayerSelf(a, entry.playerId)),
        );
        expect(JSON.stringify(getPlayerKnowledge(b, entry.playerId))).toBe(
          JSON.stringify(getPlayerKnowledge(a, entry.playerId)),
        );
        expect(JSON.stringify(getVisibleEntities(b, entry.playerId))).toBe(
          JSON.stringify(getVisibleEntities(a, entry.playerId)),
        );
        expect(JSON.stringify(getVisibleSurfaces(b, entry.playerId))).toBe(
          JSON.stringify(getVisibleSurfaces(a, entry.playerId)),
        );
      }
    }
    // The scenario really exercised the rules under audit.
    const kinds = new Set(first.events.map((e) => e.type));
    for (const type of [
      'EXCHANGE_OFFER',
      'EXCHANGE_COMPLETED',
      'HUNTER_MARKER',
      'EXIT_CHALLENGE',
      'EXIT_CHALLENGE_ENDED',
      'SPATIAL_SOUND',
    ]) {
      expect(kinds).toContain(type);
    }
  });

  it('keeps every projection and event payload inside its allowed fields', () => {
    const run = scriptedRun();
    for (const state of run.states) {
      const frame = getFrame(state);
      expect(within(keysOf(frame), ALLOWED.frame)).toBe(true);
      for (const subject of frame.participants) {
        expect(within(keysOf(subject), ALLOWED.subject)).toBe(true);
      }
      for (const entry of roster) {
        const self = getPlayerSelf(state, entry.playerId)!;
        expect(
          within(keysOf(self), self.status === 'ACTIVE' ? ALLOWED.selfActive : ALLOWED.selfEnded),
        ).toBe(true);
        const knowledge = getPlayerKnowledge(state, entry.playerId);
        expect(within(keysOf(knowledge), ALLOWED.knowledge)).toBe(true);
        for (const exit of knowledge.knownActiveExits) {
          expect(within(keysOf(exit), ALLOWED.knownExit)).toBe(true);
          // poseKind is revealed by the challenge, never by knowledge.
          expect('poseKind' in exit).toBe(false);
        }
        // A tagger never learns that exits exist.
        if (entry.role === 'tagger') expect(knowledge.knownActiveExits).toEqual([]);
        for (const entity of getVisibleEntities(state, entry.playerId)) {
          const allowed =
            entity.kind === 'player'
              ? ALLOWED.entityPlayer
              : entity.kind === 'sensor'
                ? ALLOWED.entitySensor
                : ALLOWED.entityTrap;
          expect(within(keysOf(entity), allowed)).toBe(true);
          // A device entity carries no owner and no armed-tick schedule.
          if (entity.kind !== 'player') {
            expect(JSON.stringify(entity)).not.toContain('t-a');
            expect('armedTick' in entity).toBe(false);
          }
        }
      }
    }
    for (const outcome of run.outcomes) {
      expect(within(keysOf(outcome), ALLOWED.outcome)).toBe(true);
      // stateVersion is attached by the server, never by core.
      expect('stateVersion' in (outcome as object)).toBe(false);
    }
    for (const event of run.events) {
      if (event.type === 'SPATIAL_SOUND') {
        expect(within(keysOf(event), ['sound', 'type'])).toBe(true);
        expect(within(keysOf(event.sound), ALLOWED.sound)).toBe(true);
        continue;
      }
      expect(within(keysOf(event), ALLOWED.event)).toBe(true);
      const allowed = ALLOWED.payloads[event.type];
      expect(allowed, `no allow-list for ${event.type}`).toBeDefined();
      expect(within(keysOf(event.payload), allowed!)).toBe(true);
      // Tagger map markers never name a runner.
      if (event.type === 'HUNTER_MARKER') {
        for (const id of ['r-a', 'r-b', 'r-c']) {
          expect(JSON.stringify(event.payload)).not.toContain(id);
        }
        expect(event.audience.every((id) => id.startsWith('t-'))).toBe(true);
      }
    }
  });

  it('holds the state invariants of every D2 rule at the end of the run', () => {
    const run = scriptedRun();
    const last = run.states.at(-1)!;

    // Event ids are unique across the whole run.
    const ids = run.events.map((e) => (e.type === 'SPATIAL_SOUND' ? e.sound.eventId : e.eventId));
    expect(new Set(ids).size).toBe(ids.length);

    // No ghost exchange: every session has both slots, every slot has a session.
    for (const [exchangeId, session] of last.exchanges) {
      for (const id of [session.fromPlayerId, session.toPlayerId]) {
        expect(player(last, id).exchange?.exchangeId).toBe(exchangeId);
      }
    }
    for (const entry of roster) {
      const view = player(last, entry.playerId).exchange;
      if (view) expect(last.exchanges.has(view.exchangeId)).toBe(true);
    }

    // Every device was spent at most once and no charge was created.
    for (const entry of roster) {
      const record = player(last, entry.playerId);
      const owned = record.ownedEquipment;
      expect(new Set(owned.map((e) => e.equipmentId)).size).toBe(owned.length);
      const budget = entry.role === 'tagger' ? 1 : 0;
      for (const kind of ['sensor', 'trap'] as const) {
        const built = owned.filter((e) => e.kind === kind).length;
        expect(record.equipment[kind] + built).toBe(budget);
      }
      // One device per cell across the whole match.
      if (record.installation) expect(last.installations.has(record.installation.installationId));
    }
    const cells = roster.flatMap((entry) =>
      player(last, entry.playerId).ownedEquipment.map((e) => `${e.cell.x},${e.cell.y}`),
    );
    expect(new Set(cells).size).toBe(cells.length);

    // A marker id is scheduled at most once, and none is left unpublished.
    const markerIds = run.events
      .filter((e) => e.type === 'HUNTER_MARKER')
      .map((e) => (e.type === 'HUNTER_MARKER' ? e.payload.markerId : ''));
    expect(new Set(markerIds).size).toBe(markerIds.length);
    expect(last.traces.size).toBe(0);

    // The escape was recorded once, with the exit closed and no challenge left.
    expect(player(last, 'r-a').status).toBe('ESCAPED');
    expect(last.counts).toEqual({ escaped: 1, captured: 0 });
    expect(exitOfOwner(last.exits, 'r-a')!.active).toBe(false);
    for (const entry of roster) expect(player(last, entry.playerId).challenge).toBeNull();
    const escapes = run.events.filter(
      (e) => e.type === 'EXIT_CHALLENGE_ENDED' && e.payload.result === 'escaped',
    );
    expect(escapes).toHaveLength(1);
  });

  it('gives exactly one outcome per command and none for internal upkeep', () => {
    const state = place(
      stepMatch(createTestMatch({ seed: 3 }), {
        tick: 1,
        commands: [],
        controls: [{ type: 'START_PLAYING', startTick: 1 }],
      }).state,
      { 'r-a': { x: 10, y: 2, dir: 1 }, 'r-b': { x: 11, y: 2, dir: 3 } },
    );
    const commands = [
      command('r-a', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-b' }),
      command('r-a', 'TURN', { direction: 'left' }),
      command('r-c', 'MOVE_INTENT', { direction: 'forward' }),
      command('t-a', 'INSTALL', { kind: 'trap' }),
      command('r-b', 'EXIT_START', { exitId: 'exit-1' }),
    ];
    const result = step(state, 2, commands);
    expect(result.outcomes).toHaveLength(commands.length);
    expect(result.outcomes.map((o) => o.requestId)).toEqual(commands.map((c) => c.requestId));
    expect(result.outcomes.map((o) => o.sequence)).toEqual(commands.map((c) => c.sequence));
    expect(result.outcomes.every((o) => o.tick === 2)).toBe(true);
    // Upkeep-only ticks answer nothing.
    expect(step(result.state, 3).outcomes).toEqual([]);
  });
});
