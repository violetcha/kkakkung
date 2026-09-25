import { describe, expect, it } from 'vitest';
import type { Action, Dir } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { REMOTE_RENDER_DELAY_TICKS, remoteTick } from './action-interpolation';
import {
  chainPosition,
  leadPosition,
  moveChainTarget,
  moveLeadActive,
  moveLeadTarget,
  MOVE_CHAIN_MAX_TICKS,
  MOVE_LEAD_GRACE_MS,
} from './move-lead';

const from = { x: 1, y: 1 };
const to = { x: 1, y: 0 };
const idle = { cell: from, dir: 0 as Dir, action: null };
const moving = (startTick: number) => ({
  cell: from,
  dir: 0 as Dir,
  action: {
    kind: 'move',
    startTick,
    endTick: startTick + 12,
    from: { ...from, dir: 0 },
    to: { ...to, dir: 0 },
  } as Action,
});

// S15P21C204-389. 확실한 한 칸 이동만 카메라가 먼저 시작한다.
describe('move lead target', () => {
  const self = viewFixture().self!;
  const floorAhead = viewFixture({
    knownTerrain: [
      { x: 1, y: 1, kind: 'floor' },
      { x: 1, y: 0, kind: 'floor' },
    ],
  });

  it('predicts only into a passage I already know', () => {
    expect(moveLeadTarget(floorAhead, 'forward')).toEqual(to);
    // 기본 fixture 의 앞은 벽이다. 뒤 칸(1,2)은 모른다.
    expect(moveLeadTarget(viewFixture(), 'forward')).toBeNull();
    expect(moveLeadTarget(floorAhead, 'back')).toBeNull();
    expect(moveLeadTarget(floorAhead, null)).toBeNull();
  });

  it('does not predict while restrained, challenging or already acting', () => {
    const at = (patch: Partial<typeof self>) =>
      moveLeadTarget(
        { ...floorAhead, self: { ...self, ...patch } } as typeof floorAhead,
        'forward',
      );
    expect(at({ restraintUntilTick: 140 })).toBeNull();
    expect(at({ action: moving(100).action })).toBeNull();
    expect(
      at({
        challenge: {
          challengeId: 'c',
          exitId: 'exit',
          poseKind: 'left',
          minSuccessTick: 140,
          expiresAtTick: 260,
        },
      } as Partial<typeof self>),
    ).toBeNull();
  });
});

describe('move lead position', () => {
  const lead = (ageMs: number) => ({ from, to, dir: 0 as Dir, ageMs });

  it('starts moving before the server does and never falls behind it', () => {
    expect(leadPosition({ x: 1, z: 1 }, idle, lead(300), 100)).toEqual({ x: 1, z: 0.5 });
    // 서버가 막 시작했으면(진행 0) 예측을, 예측이 끝났으면 도착 칸을 그린다.
    expect(leadPosition({ x: 1, z: 1 }, moving(100), lead(450), 100)).toEqual({ x: 1, z: 0.25 });
    expect(leadPosition({ x: 1, z: 1 }, moving(100), lead(700), 101)).toEqual({ x: 1, z: 0 });
  });

  it('hands over to the server when the move is done or does not match', () => {
    const arrived = { cell: to, dir: 0 as Dir, action: null };
    expect(leadPosition({ x: 1, z: 0 }, arrived, lead(700), 200)).toEqual({ x: 1, z: 0 });
    const turned = { ...idle, dir: 1 as Dir };
    expect(leadPosition({ x: 1, z: 1 }, turned, lead(100), 100)).toEqual({ x: 1, z: 1 });
  });

  it('drops a lead the server never followed', () => {
    const stale = lead(600 + MOVE_LEAD_GRACE_MS);
    expect(moveLeadActive(stale)).toBe(false);
    expect(leadPosition({ x: 1, z: 1 }, idle, stale, 100)).toEqual({ x: 1, z: 1 });
  });
});

// S15P21C204-399. 누른 채 걸으면 칸 끝에서 서버 소식을 기다리지 않고 다음 칸으로 이어 걷는다.
describe('move chain', () => {
  const self = viewFixture().self!;
  // (1,1)에서 북쪽(1,0)으로 걷는 중이고, 그 앞(1,-1)도 아는 통로다.
  const walking = (patch: Partial<typeof self> = {}, floorNext = true) =>
    viewFixture({
      knownTerrain: [
        { x: 1, y: 1, kind: 'floor' },
        { x: 1, y: 0, kind: 'floor' },
        ...(floorNext ? [{ x: 1, y: -1, kind: 'floor' as const }] : []),
      ],
      self: { ...self, cell: from, dir: 0, action: moving(100).action, ...patch },
    } as Parameters<typeof viewFixture>[0]);

  it('continues only when the server will surely keep walking', () => {
    expect(moveChainTarget(walking(), 'forward', null)).toEqual({
      to,
      next: { x: 1, y: -1 },
      endTick: 112,
      lengthTicks: 12,
    });
    expect(moveChainTarget(walking(), null, null)).toBeNull();
    expect(moveChainTarget(walking(), 'back', null)).toBeNull();
    expect(moveChainTarget(walking({}, false), 'forward', null)).toBeNull();
    // 이 이동 중에 회전을 보냈으면 서버가 회전을 먼저 한다.
    expect(moveChainTarget(walking(), 'forward', 112)).toBeNull();
    expect(moveChainTarget(walking({ restraintUntilTick: 130 }), 'forward', null)).toBeNull();
    expect(moveChainTarget(walking({ action: null }), 'forward', null)).toBeNull();
  });

  it('walks on past the cell end and stops a few ticks ahead at most', () => {
    const chain = moveChainTarget(walking(), 'forward', null);
    const actor = moving(100);
    const at = { x: to.x, z: to.y };
    // 이동이 끝나기 전에는 서버 보간 그대로다.
    expect(chainPosition({ x: 1, z: 0.5 }, actor, chain, 106)).toEqual({ x: 1, z: 0.5 });
    expect(chainPosition(at, actor, chain, 115).z).toBeCloseTo(-3 / 12);
    expect(chainPosition(at, actor, chain, 200).z).toBeCloseTo(-MOVE_CHAIN_MAX_TICKS / 12);
    // 서버가 다음 이동을 보내면 그 이동이 이어받는다. 끝난 이동에 대한 예측은 버린다.
    expect(chainPosition(at, moving(112), chain, 115)).toEqual(at);
  });

  it('meets the next server move at the same spot', () => {
    const chain = moveChainTarget(walking(), 'forward', null);
    const predicted = chainPosition({ x: to.x, z: to.y }, moving(100), chain, 114);
    // 서버의 다음 이동은 (1,0)에서 (1,-1)로 112틱에 시작한다.
    const next = { startTick: 112, endTick: 124 };
    const server = to.y + (-1 - to.y) * ((114 - next.startTick) / (next.endTick - next.startTick));
    expect(predicted.z).toBeCloseTo(server);
  });
});

// S15P21C204-399. 다른 사람은 100ms(2틱) 늦춰 그려, 다음 칸 소식이 먼저 도착하게 한다.
it('draws other people two ticks behind', () => {
  expect(remoteTick(120)).toBe(118);
  expect(remoteTick(null)).toBeNull();
  expect(REMOTE_RENDER_DELAY_TICKS).toBe(2);
});
