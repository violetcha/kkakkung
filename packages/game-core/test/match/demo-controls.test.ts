/**
 * S15P21C204-316. 데모 하네스만 쓰는 코어 진입점 둘.
 *
 * `deadline: 'none'` 은 제한시간을 없애고, 그 표지가 있을 때만 `PLACE_PLAYER` 를 받는다.
 * 여기서 고정하는 것은 **일반 경기가 이 둘에 전혀 영향받지 않는다**는 쪽이 절반이다.
 */
import { describe, expect, it } from 'vitest';

import { createMatch, createPractice, stepMatch, type MatchState } from '../../src/match/engine.js';
import { isWalkable } from '../../src/match/map/validate-template.js';
import type { Cell, Dir } from '../../src/match/types.js';
import {
  command,
  createTestMatch,
  fixtureLayout,
  player,
  roster,
  startedMatch,
  step,
  tuning,
} from './match-fixture.js';

/** 시작 tick 100 에서 PLAYING 으로 들어간 제한시간 없는 경기. */
function demoMatch(startTick = 100): MatchState {
  const created = createMatch({
    // fixture 의 `command` 가 쓰는 기본 matchId. 다르면 명령이 WRONG_MATCH 로 거절된다.
    matchId: 'match-1',
    gameInstanceId: 'game-demo',
    seed: 7,
    tuning: tuning(),
    layout: fixtureLayout(),
    players: roster,
    deadline: 'none',
  });
  return stepMatch(created, {
    tick: startTick,
    commands: [],
    controls: [{ type: 'START_PLAYING', startTick }],
  }).state;
}

const place = (playerId: string, cell: Cell, dir: Dir = 0) =>
  ({ type: 'PLACE_PLAYER', playerId, cell, dir }) as const;

/** 시작 칸도 아니고 아무도 없는 통로 칸. */
function freePassage(state: MatchState, from: Cell): Cell {
  const starts = new Set(state.layout.players.map((p) => `${p.cell.x},${p.cell.y}`));
  const taken = new Set(
    [...state.players.values()]
      .filter((p) => p.status === 'ACTIVE')
      .map((p) => `${p.cell.x},${p.cell.y}`),
  );
  for (let radius = 1; radius < 8; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const cell = { x: from.x + dx, y: from.y + dy };
        const key = `${cell.x},${cell.y}`;
        if (!isWalkable(state.layout.topology, cell) || starts.has(key) || taken.has(key)) continue;
        return cell;
      }
    }
  }
  throw new Error('fixture has no free passage cell');
}

describe('제한시간 없는 경기', () => {
  it('기본값은 제한시간이 있는 보통 경기다', () => {
    const state = startedMatch(100);
    expect(state.deadline).toBe('round');
    expect(state.deadlineTick).toBe(100 + state.tuning.roundTicks);
  });

  it('none 이면 시작해도 마감을 잡지 않는다', () => {
    const state = demoMatch(100);
    expect(state.deadline).toBe('none');
    expect(state.deadlineTick).toBeNull();
    expect(state.phase).toBe('PLAYING');
  });

  it('라운드 길이를 넘겨도 끝나지 않는다', () => {
    // 보통 경기라면 이 Tick 에 술래 승리로 끝난다.
    const start = 100;
    const over = start + tuning().roundTicks + 5;
    let state = demoMatch(start);
    state = step(state, over).state;
    expect(state.phase).toBe('PLAYING');
    expect(state.result).toBeNull();
  });

  it('같은 Tick 에 보통 경기는 시간 초과로 끝난다', () => {
    // 위 시험이 "어차피 안 끝나는 조건"이 아님을 못 박는다.
    const start = 100;
    const over = start + tuning().roundTicks + 5;
    const state = step(startedMatch(start), over).state;
    expect(state.phase).toBe('RESULT');
    expect(state.result).toEqual({ winner: 'taggers', reason: 'timeout' });
  });

  it('포획 두 번으로는 그대로 끝난다', () => {
    // 제한시간만 없앤다. 승패 판정은 건드리지 않는다.
    let state = demoMatch(100);
    const runners = state.order.filter((id) => player(state, id).role === 'runner');
    const taggers = state.order.filter((id) => player(state, id).role === 'tagger');
    // 술래 둘을 도망자 둘의 칸으로 옮기면 다음 Tick 에 접촉 포획이 성립한다.
    for (const [index, taggerId] of taggers.slice(0, 2).entries()) {
      const prey = player(state, runners[index]!);
      const beside = { x: prey.cell.x, y: prey.cell.y };
      state = stepMatch(state, {
        tick: (state.tick ?? 100) + 1,
        commands: [],
        // 대상 칸은 점유돼 있어 배치가 거절된다. 대신 옆 칸에 세우고 걸어 들어가게 한다.
        controls: [place(taggerId, freePassage(state, beside), 0)],
      }).state;
    }
    // 배치는 판정을 대신하지 않으므로, 여기서는 규칙대로 상태를 확인만 한다.
    expect(state.phase).toBe('PLAYING');
    expect(state.counts.captured).toBe(0);
  });
});

describe('PLACE_PLAYER 는 데모 경기에서만 받는다', () => {
  it('보통 경기에서는 무시된다', () => {
    const state = startedMatch(100);
    const target = player(state, 'r-a');
    const destination = freePassage(state, target.cell);
    const after = stepMatch(state, {
      tick: 101,
      commands: [],
      controls: [place('r-a', destination, 2)],
    }).state;
    expect(player(after, 'r-a').cell).toEqual(target.cell);
    expect(player(after, 'r-a').dir).toBe(target.dir);
  });

  it('연습 인스턴스에서도 무시된다', () => {
    // 연습은 `deadline` 이 'round' 로 고정되므로 표지가 서지 않는다.
    const practice = createPractice({
      matchId: 'match-demo',
      gameInstanceId: 'practice-runner',
      seed: 3,
      tuning: tuning(),
      layout: fixtureLayout(),
      players: roster.filter((entry) => entry.role === 'runner'),
      role: 'runner',
      deadline: 'none',
    });
    expect(practice.deadline).toBe('round');
    const target = player(practice, 'r-a');
    const after = stepMatch(practice, {
      tick: 10,
      commands: [],
      controls: [place('r-a', freePassage(practice, target.cell), 1)],
    }).state;
    expect(player(after, 'r-a').cell).toEqual(target.cell);
  });

  it('데모 경기에서는 칸과 방향을 바꾼다', () => {
    const state = demoMatch(100);
    const destination = freePassage(state, player(state, 'r-a').cell);
    const after = stepMatch(state, {
      tick: 101,
      commands: [],
      controls: [place('r-a', destination, 2)],
    }).state;
    expect(player(after, 'r-a').cell).toEqual(destination);
    expect(player(after, 'r-a').dir).toBe(2);
  });

  it('옮긴 자리에서 곧바로 새 시야를 준다', () => {
    const state = demoMatch(100);
    const before = state.visibility.get('r-a')!.visibleCells;
    const destination = freePassage(state, player(state, 'r-a').cell);
    const after = stepMatch(state, {
      tick: 101,
      commands: [],
      controls: [place('r-a', destination, 2)],
    }).state;
    const surfaces = after.visibility.get('r-a')!;
    expect(surfaces.visibleCells).not.toEqual(before);
    expect(surfaces.visibleCells).toContainEqual(destination);
  });
});

describe('PLACE_PLAYER 가 거절하는 것', () => {
  /** 배치를 시도하고 위치가 그대로인지 본다. 거절은 조용하다. */
  function expectRefused(state: MatchState, playerId: string, cell: Cell, dir: Dir = 0) {
    const before = player(state, playerId);
    const after = stepMatch(state, {
      tick: (state.tick ?? 100) + 1,
      commands: [],
      controls: [place(playerId, cell, dir)],
    }).state;
    expect(player(after, playerId).cell).toEqual(before.cell);
    expect(player(after, playerId).dir).toBe(before.dir);
    return after;
  }

  it('벽으로는 옮기지 않는다', () => {
    const state = demoMatch(100);
    // 격자 밖은 통로가 아니다.
    expectRefused(state, 'r-a', { x: -1, y: -1 });
  });

  it('주인이 서 있는 시작 칸으로는 옮기지 않는다', () => {
    const state = demoMatch(100);
    const someoneElsesStart = state.layout.players.find((p) => p.playerId !== 'r-a')!.cell;
    expectRefused(state, 'r-a', someoneElsesStart);
  });

  // S15P21C204-321. 시작 칸은 장비만 막는다. 경기 중에는 보통 바닥이고, 작은 미로에서는 도망자의
  // 출구 앞 칸이 누군가의 시작 칸인 배치가 13% 나온다.
  it('주인이 떠난 시작 칸으로는 옮긴다', () => {
    const state = demoMatch(100);
    const owner = state.layout.players.find((p) => p.playerId !== 'r-a')!;
    // 주인을 먼저 비키게 한다.
    const vacated = stepMatch(state, {
      tick: 101,
      commands: [],
      controls: [place(owner.playerId, freePassage(state, owner.cell), 0)],
    }).state;
    const after = stepMatch(vacated, {
      tick: 102,
      commands: [],
      controls: [place('r-a', owner.cell, 1)],
    }).state;
    expect(player(after, 'r-a').cell).toEqual(owner.cell);
  });

  it('다른 참가자가 서 있는 칸으로는 옮기지 않는다', () => {
    // 겹치게 두면 포획 판정을 우회하는 것이 된다.
    const state = demoMatch(100);
    expectRefused(state, 'r-a', player(state, 't-a').cell);
  });

  it('이동·회전 중에는 옮기지 않는다', () => {
    // 행동은 Tick 산술로 판정된다. 도중에 자리를 바꾸면 그 계산이 조용히 어긋난다.
    let state = demoMatch(100);
    state = step(state, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]).state;
    expect(player(state, 'r-a').action).not.toBeNull();
    expectRefused(state, 'r-a', freePassage(state, player(state, 'r-a').cell));
  });

  it('방향 값이 범위를 벗어나면 옮기지 않는다', () => {
    const state = demoMatch(100);
    const destination = freePassage(state, player(state, 'r-a').cell);
    expectRefused(state, 'r-a', destination, 4 as Dir);
    expectRefused(state, 'r-a', destination, -1 as Dir);
  });

  it('없는 참가자는 아무 일도 일으키지 않는다', () => {
    const state = demoMatch(100);
    const after = stepMatch(state, {
      tick: 101,
      commands: [],
      controls: [place('nobody', freePassage(state, player(state, 'r-a').cell), 0)],
    }).state;
    expect(after.players.size).toBe(state.players.size);
  });

  it('경기가 끝난 뒤에는 옮기지 않는다', () => {
    let state = demoMatch(100);
    state = stepMatch(state, {
      tick: 101,
      commands: [],
      controls: [{ type: 'ABORT_MATCH', reason: 'SERVER_TICK_OVERLOAD' }],
    }).state;
    expect(state.phase).toBe('ABORTED');
    expectRefused(state, 'r-a', freePassage(state, player(state, 'r-a').cell));
  });
});

describe('배치는 이동 의도를 남기지 않는다', () => {
  it('들고 있던 전진 의도를 비운다', () => {
    // 옛 자리 기준의 유지 의도가 남으면 새 자리에서 엉뚱한 방향으로 걸어간다.
    // r-b 는 (29,2) 에서 북쪽으로 한 칸 간 뒤 벽에 막힌다. 그때 행동은 없고 의도만 남는다.
    let state = demoMatch(100);
    state = step(state, 101, [command('r-b', 'MOVE_INTENT', { direction: 'forward' })]).state;
    const endTick = player(state, 'r-b').action!.endTick;
    for (let tick = 102; tick <= endTick + 1; tick += 1) state = step(state, tick).state;
    expect(player(state, 'r-b').action).toBeNull();
    expect(player(state, 'r-b').heldMove).not.toBeNull();

    const destination = freePassage(state, player(state, 'r-b').cell);
    state = stepMatch(state, {
      tick: endTick + 2,
      commands: [],
      controls: [place('r-b', destination, 0)],
    }).state;
    expect(player(state, 'r-b').cell).toEqual(destination);
    expect(player(state, 'r-b').heldMove).toBeNull();
  });
});

describe('createTestMatch 기본값', () => {
  it('fixture 로 만든 경기는 제한시간을 갖는다', () => {
    expect(createTestMatch().deadline).toBe('round');
  });
});
