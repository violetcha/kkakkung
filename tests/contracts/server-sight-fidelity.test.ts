/**
 * S15P21C204-301. 서버가 승인한 현재 시야가 화면까지 그대로 도착하는지 실제 코어로 확인한다.
 *
 * 웹은 의존 경계 때문에 `game-core` 를 import 할 수 없다. 계약 시험만 양쪽을 함께 읽을 수
 * 있어, 코어가 내놓은 집합과 렌더러가 받는 집합을 맞대는 자리는 여기뿐이다.
 *
 * 로컬 단위 범위다. 실제 서버·전송·브라우저는 쓰지 않는다.
 */
import { describe, expect, it } from 'vitest';

import { visibilityMask } from '../../apps/web/src/features/game/scene/visibility-mask';
import { viewFixture } from '../../apps/web/src/features/room/product-fixture';
import {
  getPlayerKnowledge,
  getPlayerSelf,
  getVisibleEntities,
  getVisibleSurfaces,
  type MatchState,
} from '../../packages/game-core/src/match/engine';
import { command, startedMatch, step } from '../../packages/game-core/test/match/match-fixture';

/** 코어가 그 플레이어에게 승인한 것을 그대로 담은 제품 뷰. 서버가 만드는 것과 같은 모양이다. */
function viewOf(state: MatchState, playerId: string) {
  return viewFixture({
    self: getPlayerSelf(state, playerId),
    ...getVisibleSurfaces(state, playerId),
    visibleEntities: getVisibleEntities(state, playerId),
    ...getPlayerKnowledge(state, playerId),
  });
}

/** 코어 출력과 마스크 출력이 정확히 같은지. 누락도 추가도 0이어야 한다. */
function expectFaithful(state: MatchState, playerId: string) {
  const surfaces = getVisibleSurfaces(state, playerId);
  const mask = visibilityMask(viewOf(state, playerId));
  expect(mask.cells).toEqual(surfaces.visibleCells);
  expect(mask.walls).toEqual(surfaces.visibleWallFaces);
  return { surfaces, mask };
}

const RUNNERS = ['r-a', 'r-b', 'r-c'] as const;
const TAGGERS = ['t-a', 't-b', 't-c'] as const;

describe('서버가 승인한 현재 시야는 잘리지 않는다', () => {
  it('정지 상태에서 여섯 명 모두 코어 출력을 그대로 받는다', () => {
    const state = startedMatch(100);
    for (const playerId of [...RUNNERS, ...TAGGERS]) {
      const { surfaces } = expectFaithful(state, playerId);
      // 빈 집합끼리 같아서 통과하는 것을 막는다.
      expect(surfaces.visibleCells.length).toBeGreaterThan(0);
      expect(surfaces.visibleWallFaces.length).toBeGreaterThan(0);
    }
  });

  it.each([0, 1, 2, 3] as const)('네 방향 어디를 보고 있어도 같다(dir %i)', (dir) => {
    // 시야 원뿔이 축에 정렬되지 않은 방향에서 대각선 셀이 생긴다. 예전 마스크가 그것을
    // 정수 거리로 잘라 냈다.
    const start = startedMatch(100);
    const players = new Map(start.players);
    players.set('r-a', { ...players.get('r-a')!, dir });
    const state = step({ ...start, players }, 101).state;
    const { surfaces } = expectFaithful(state, 'r-a');
    expect(surfaces.visibleCells.length).toBeGreaterThan(0);
  });

  it('이동하는 동안 매 Tick 같다', () => {
    // 코어 카메라는 from→to 로 보간되는데 `player.cell` 은 도착 Tick 에만 바뀐다. 셀을
    // 기준점으로 삼아 자르면 이동 후반에 가장자리가 깜빡였다.
    let state = step(startedMatch(100), 101, [
      command('r-a', 'MOVE_INTENT', { direction: 'back' }),
    ]).state;
    for (let tick = 102; tick <= 112; tick += 1) {
      state = step(state, tick).state;
      expectFaithful(state, 'r-a');
    }
  });

  it('회전하는 동안 매 Tick 같다', () => {
    let state = step(startedMatch(100), 101, [command('r-a', 'TURN', { direction: 'left' })]).state;
    for (let tick = 102; tick <= 110; tick += 1) {
      state = step(state, tick).state;
      expectFaithful(state, 'r-a');
    }
  });

  it('맵 모서리에서도 같다', () => {
    // 격자 밖으로 나가는 샘플점이 생기는 자리다. 잘라 내는 쪽과 보내는 쪽의 경계 처리가
    // 다르면 여기서 먼저 갈린다.
    const start = startedMatch(100);
    const players = new Map(start.players);
    players.set('r-a', { ...players.get('r-a')!, cell: { x: 1, y: 1 }, dir: 0 });
    const state = step({ ...start, players }, 101).state;
    expectFaithful(state, 'r-a');
  });
});

describe('시점 주인만 빼고 더하지 않는다', () => {
  it('보이는 참가자를 그대로 넘기고 자기 자신만 뺀다', () => {
    const start = startedMatch(100);
    // 술래 한 명을 도망자가 실제로 보고 있는 칸에 세운다. 방향을 짐작하지 않고 코어가
    // 승인한 칸에서 고른다.
    const runner = start.players.get('r-a')!;
    const target = getVisibleSurfaces(start, 'r-a').visibleCells.find(
      (cell) => cell.x !== runner.cell.x || cell.y !== runner.cell.y,
    )!;
    const players = new Map(start.players);
    players.set('t-a', { ...players.get('t-a')!, cell: target });
    const state = step({ ...start, players }, 101).state;

    const entities = getVisibleEntities(state, 'r-a');
    const mask = visibilityMask(viewOf(state, 'r-a'));
    expect(entities.some((entity) => entity.id === 't-a')).toBe(true);
    expect(mask.players.map((player) => player.id)).toEqual(
      entities.filter((entity) => entity.kind === 'player').map((entity) => entity.id),
    );
    expect(mask.players.some((player) => player.id === 'r-a')).toBe(false);
  });

  it('관전자는 대상의 시야를 그대로 받고 대상만 그리지 않는다', () => {
    const state = startedMatch(100);
    const target = 'r-b';
    const surfaces = getVisibleSurfaces(state, target);
    const view = viewFixture({
      // 포획된 도망자. 서버는 대상의 시야를 그대로 투영해 보낸다.
      self: { playerId: 'r-a', role: 'runner', status: 'CAPTURED' },
      spectating: {
        targetId: target,
        cell: state.players.get(target)!.cell,
        dir: 0,
        action: null,
        candidates: [target],
      },
      ...surfaces,
      visibleEntities: [
        { id: target, kind: 'player', cell: { x: 0, y: 0 }, dir: 0, action: null },
        { id: 't-a', kind: 'player', cell: { x: 0, y: 1 }, dir: 0, action: null },
      ],
      ...getPlayerKnowledge(state, target),
    });

    const mask = visibilityMask(view);
    expect(mask.cells).toEqual(surfaces.visibleCells);
    expect(mask.walls).toEqual(surfaces.visibleWallFaces);
    expect(mask.players.map((player) => player.id)).toEqual(['t-a']);
  });
});

describe('과거 지식은 현재 시야로 새지 않는다', () => {
  it('누적 지도가 넓어도 현재 시야만 그린다', () => {
    // `knownTerrain` 은 프로토콜에서 분리된 필드다. 마스크는 그것을 읽지 않는다.
    let state = startedMatch(100);
    state = step(state, 101, [command('r-a', 'MOVE_INTENT', { direction: 'back' })]).state;
    for (let tick = 102; tick <= 130; tick += 1) state = step(state, tick).state;

    const knowledge = getPlayerKnowledge(state, 'r-a');
    const surfaces = getVisibleSurfaces(state, 'r-a');
    const floors = knowledge.knownTerrain.filter((entry) => entry.kind === 'floor');
    // 돌아다녔으니 기억한 바닥이 지금 보이는 칸보다 많아야 이 시험이 의미가 있다.
    expect(floors.length).toBeGreaterThan(surfaces.visibleCells.length);
    expect(visibilityMask(viewOf(state, 'r-a')).cells).toEqual(surfaces.visibleCells);
  });
});
