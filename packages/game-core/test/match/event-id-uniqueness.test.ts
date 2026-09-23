/**
 * S15P21C204-351. 한 틱 안에서 발급되는 모든 도메인 이벤트와 공간음의 식별자는 서로 다르다.
 *
 * `endRunner` 가 `terminateRunner` 의 반환 상태로 `ctx.state` 를 덮으면서, 도전 종료 이벤트가
 * 올려 둔 `eventSeq` 가 사라졌다. 개인 종료 시점에 `challenge !== null` 이면(탈출 성공은 항상,
 * 도전 중 포획·시간 만료도) 그 틱의 다음 이벤트가 같은 seq 를 다시 썼다.
 */
import { describe, expect, it } from 'vitest';

import type { MatchState } from '../../src/match/engine.js';
import { exitOfOwner } from '../../src/match/exits/registry.js';
import { command, eventIdsOf, player, startedMatch, step } from './match-fixture.js';

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

function idleUntil(state: MatchState, from: number, to: number): MatchState {
  let next = state;
  for (let tick = from; tick <= to; tick += 1) next = step(next, tick).state;
  return next;
}

function exitId(state: MatchState, ownerId: string): string {
  return exitOfOwner(state.exits, ownerId)!.exitId;
}

describe('event ids within one tick', () => {
  it('keeps the escape of a challenger and a trace published on the same tick apart', () => {
    // r-a poses at its own exit (approach 11,22 facing the wall); r-b and r-c face each other.
    const posed = place(startedMatch(100), {
      'r-a': { x: 11, y: 22, dir: 1 },
      'r-b': { x: 4, y: 4, dir: 1 },
      'r-c': { x: 5, y: 4, dir: 3 },
    });
    const started = step(posed, 101, [
      command('r-a', 'EXIT_START', { exitId: exitId(posed, 'r-a') }),
    ]);
    expect(started.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(player(started.state, 'r-a').challenge).toMatchObject({ minSuccessTick: 141 });

    // An exchange accepted at 121 publishes its tagger trace at 141, the escape tick.
    const requested = step(idleUntil(started.state, 102, 119), 120, [
      command('r-b', 'EXCHANGE_REQUEST', { targetPlayerId: 'r-c' }),
    ]);
    expect(requested.outcomes[0]).toMatchObject({ result: 'applied' });
    const accepted = step(requested.state, 121, [
      command('r-c', 'EXCHANGE_ACCEPT', { exchangeId: 'xch-1' }),
    ]);
    expect(accepted.outcomes[0]).toMatchObject({ result: 'applied' });
    expect(accepted.state.traces.size).toBe(1);

    const escaped = step(idleUntil(accepted.state, 122, 140), 141, [
      command('r-a', 'EXIT_PROGRESS', { challengeId: 'ch-1', method: 'pose', completed: true }),
    ]);
    expect(player(escaped.state, 'r-a').status).toBe('ESCAPED');
    expect(escaped.events.map((e) => e.type)).toEqual(['EXIT_CHALLENGE_ENDED', 'HUNTER_MARKER']);
    // The sequence counts across the match; within the tick the two ids never coincide.
    const ids = eventIdsOf(escaped);
    expect(ids.every((id) => id.startsWith('match-1/game-1/141/'))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('gives two challengers captured on the same tick different ended-event ids', () => {
    // Each runner poses at its own exit; a tagger stands one cell behind, facing it.
    const posed = place(startedMatch(100), {
      'r-a': { x: 11, y: 22, dir: 1 },
      't-a': { x: 10, y: 22, dir: 1 },
      'r-b': { x: 25, y: 22, dir: 3 },
      't-b': { x: 26, y: 22, dir: 3 },
    });
    const started = step(posed, 101, [
      command('r-a', 'EXIT_START', { exitId: exitId(posed, 'r-a') }),
      command('r-b', 'EXIT_START', { exitId: exitId(posed, 'r-b') }),
    ]);
    expect(started.outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);
    const armed = step(started.state, 102, [
      command('t-a', 'GRAB_INTENT', {}),
      command('t-b', 'GRAB_INTENT', {}),
    ]);
    expect(armed.outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);

    const captured = step(armed.state, 103);
    expect(player(captured.state, 'r-a').status).toBe('CAPTURED');
    expect(player(captured.state, 'r-b').status).toBe('CAPTURED');
    expect(captured.events.map((e) => e.type)).toEqual([
      'EXIT_CHALLENGE_ENDED',
      'EXIT_CHALLENGE_ENDED',
    ]);
    const ids = eventIdsOf(captured);
    expect(ids.every((id) => id.startsWith('match-1/game-1/103/'))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });
});
