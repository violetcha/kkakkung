import { describe, expect, it } from 'vitest';
import type { Action, Dir } from '@kkakkung/protocol/game-schema';
import { directionYaw } from './scene-model';
import { leadYaw, turnLeadActive, TURN_LEAD_GRACE_MS } from './turn-lead';

const cell = { x: 3, y: 3 };
const idle = (dir: Dir) => ({ cell, dir, action: null });
const turning = (
  from: Dir,
  to: Dir,
  startTick: number,
): { cell: typeof cell; dir: Dir; action: Action } => ({
  cell,
  dir: from,
  action: {
    kind: 'turn',
    startTick,
    endTick: startTick + 8,
    from: { ...cell, dir: from },
    to: { ...cell, dir: to },
  } as Action,
});
const quarter = Math.PI / 2;

// S15P21C204-388. 보낸 회전을 카메라가 먼저 따라가되, 서버 방향을 넘어서거나 뒤로 튀지 않는다.
describe('turn lead', () => {
  it('starts turning before the server does', () => {
    const lead = { fromDir: 0 as Dir, direction: 'right' as const, ageMs: 200 };
    expect(leadYaw(directionYaw(0), idle(0), lead, 100)).toBeCloseTo(directionYaw(0) - quarter / 2);
  });

  it('follows whichever of the lead and the server turn is further along', () => {
    const lead = { fromDir: 0 as Dir, direction: 'left' as const, ageMs: 300 };
    const late = turning(0, 3, 100);
    // 서버는 막 시작했고(진행 0), 예측은 3/4 지났다: 예측을 그린다.
    expect(leadYaw(directionYaw(0), late, lead, 100)).toBeCloseTo(directionYaw(0) + quarter * 0.75);
    // 예측이 끝나도 서버 회전이 끝날 때까지 목표 방향에 머문다.
    const done = { ...lead, ageMs: 450 };
    expect(leadYaw(directionYaw(0), late, done, 104)).toBeCloseTo(directionYaw(0) + quarter);
  });

  it('hands over to the server once the turn is done, or when it does not match', () => {
    const lead = { fromDir: 0 as Dir, direction: 'right' as const, ageMs: 500 };
    expect(leadYaw(directionYaw(1), idle(1), lead, 200)).toBe(directionYaw(1));
    // 서버가 다른 동작(이동)을 하고 있으면 예측을 쓰지 않는다.
    const moving = {
      ...turning(0, 1, 100),
      action: { ...turning(0, 1, 100).action, kind: 'move' } as Action,
    };
    expect(leadYaw(1.23, moving, lead, 101)).toBe(1.23);
  });

  it('drops a lead the server never followed', () => {
    const stale = {
      fromDir: 0 as Dir,
      direction: 'right' as const,
      ageMs: 400 + TURN_LEAD_GRACE_MS,
    };
    expect(turnLeadActive(stale)).toBe(false);
    expect(leadYaw(directionYaw(0), idle(0), stale, 100)).toBe(directionYaw(0));
    expect(turnLeadActive(null)).toBe(false);
  });
});
