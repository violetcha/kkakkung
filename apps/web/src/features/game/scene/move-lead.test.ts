import { describe, expect, it } from 'vitest';
import type { Action, Dir } from '@kkakkung/protocol/game-schema';
import { viewFixture } from '../../room/product-fixture';
import { leadPosition, moveLeadActive, moveLeadTarget, MOVE_LEAD_GRACE_MS } from './move-lead';

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
