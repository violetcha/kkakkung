import type {
  CoreCommand,
  CoreCommandType,
  CoreCommandPayloads,
  ControlIntent,
  StepResult,
} from '../../src/match/core-types.js';
import { createMatch, createPractice, stepMatch, type MatchState } from '../../src/match/engine.js';
import { bindFallbackPlayers } from '../../src/match/map/select-with-fallback.js';
import { validateTuning } from '../../src/match/tuning.js';
import type {
  FallbackLayout,
  MatchLayout,
  MatchTuning,
  Role,
  RosterEntry,
} from '../../src/match/types.js';
import { loadFallback, loadPractice, loadTuning, masterTemplate } from './helpers.js';
import { preparePracticeLayout } from '../../src/match/map/prepare-practice-layout.js';

export const TAGGERS = ['t-a', 't-b', 't-c'] as const;
export const RUNNERS = ['r-a', 'r-b', 'r-c'] as const;

export const roster: RosterEntry[] = [
  { playerId: 't-a', role: 'tagger' },
  { playerId: 't-b', role: 'tagger' },
  { playerId: 't-c', role: 'tagger' },
  { playerId: 'r-a', role: 'runner' },
  { playerId: 'r-b', role: 'runner' },
  { playerId: 'r-c', role: 'runner' },
];

/**
 * Rule tests read the shipped profile for every fixed constant but pin the speed at the original
 * 9-tick move / 6-tick turn: their tick-by-tick expectations describe the rules at that pace and
 * would only be renumbered by a speed change (S15P21C204-270). The shipped speed itself is
 * checked by template.test and, against the protocol mirror, by the server profile test.
 */
export function tuning(): MatchTuning {
  const result = validateTuning(loadTuning());
  if (!result.ok) throw new Error('tuning invalid');
  return Object.freeze({ ...result.template.match, moveTicks: 9, turnTicks: 6 });
}

/** Identity fallback bound to the test roster: taggers (8,16)/(16,12)/(25,16), runners (2,2)/(29,2)/(16,30). */
export function fixtureLayout(): MatchLayout {
  const file = loadFallback() as { fallbacks: FallbackLayout[] };
  const identity = file.fallbacks.find((f) => f.variantId === 'r0')!;
  const bound = bindFallbackPlayers(identity.layout, roster);
  if (!bound) throw new Error('fallback binding failed');
  return bound;
}

export function createTestMatch(
  overrides: Partial<{ matchId: string; gameInstanceId: string; seed: number }> = {},
): MatchState {
  return createMatch({
    matchId: overrides.matchId ?? 'match-1',
    gameInstanceId: overrides.gameInstanceId ?? 'game-1',
    seed: overrides.seed ?? 7,
    tuning: tuning(),
    layout: fixtureLayout(),
    players: roster,
  });
}

/** Match already in PLAYING with startTick = tick. */
export function startedMatch(startTick = 100): MatchState {
  return stepMatch(createTestMatch(), {
    tick: startTick,
    commands: [],
    controls: [{ type: 'START_PLAYING', startTick }],
  }).state;
}

export function createTestPractice(role: Role, ids: readonly string[]): MatchState {
  const players = ids.map((playerId) => ({ playerId, role }));
  const prepared = preparePracticeLayout(loadPractice(), players, role);
  if (prepared.status !== 'ready') throw new Error('practice layout failed');
  const layout = prepared.layout;
  return createPractice({
    matchId: 'match-1',
    gameInstanceId: `practice-${role}`,
    seed: 3,
    tuning: tuning(),
    layout,
    players,
    role,
  });
}

let requestCounter = 0;

export function command<K extends CoreCommandType>(
  actorId: string,
  type: K,
  payload: CoreCommandPayloads[K],
  options: Partial<{ requestId: string; sequence: number; matchId: string }> = {},
): CoreCommand<K> {
  requestCounter += 1;
  return {
    matchId: options.matchId ?? 'match-1',
    requestId: options.requestId ?? `req-${requestCounter}`,
    sequence: options.sequence ?? requestCounter,
    type,
    payload,
    actorId,
  } as CoreCommand<K>;
}

/** Identifier of every domain event and spatial sound in one step result, in emission order. */
export function eventIdsOf(result: StepResult<MatchState>): string[] {
  return result.events.map((e) => (e.type === 'SPATIAL_SOUND' ? e.sound.eventId : e.eventId));
}

/**
 * S15P21C204-351. `DomainEvent.eventId` is unique within a tick ("each carries its own id").
 * Every scripted step goes through this so a new event path that reuses a sequence number
 * fails the test that exercises it, not a replay months later.
 */
export function assertUniqueEventIds(result: StepResult<MatchState>): void {
  const ids = eventIdsOf(result);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new Error(`duplicate eventId in tick ${result.state.tick}: ${duplicates.join(', ')}`);
  }
}

export function step(
  state: MatchState,
  tick: number,
  commands: readonly CoreCommand[] = [],
  controls: readonly ControlIntent[] = [],
) {
  const result = stepMatch(state, { tick, commands, controls });
  assertUniqueEventIds(result);
  return result;
}

export function player(state: MatchState, id: string) {
  const record = state.players.get(id);
  if (!record) throw new Error(`no player ${id}`);
  return record;
}

export { masterTemplate };
