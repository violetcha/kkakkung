import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@kkakkung/protocol/game-messages';
import { CommandQueue } from '../../src/game/CommandQueue.js';

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const move = (
  sequence: number,
  direction: 'forward' | 'back' | null = 'forward',
): CommandEnvelope => ({
  matchId: 'match-1',
  requestId: uuid(sequence),
  sequence,
  type: 'MOVE_INTENT',
  payload: { direction },
});
const exitStart = (sequence: number): CommandEnvelope => ({
  matchId: 'match-1',
  requestId: uuid(sequence),
  sequence,
  type: 'EXIT_START',
  payload: { exitId: 'exit-1' },
});
const accept = (queue: CommandQueue, actorId: string, command: CommandEnvelope, nowMs = 0) =>
  queue.accept({ actorId, command, gameInstanceId: 'game-1', nowMs, stateVersion: 40 });

describe('CommandQueue ledger', () => {
  it('accepts once, replays duplicates and rejects reuse with different content', () => {
    const queue = new CommandQueue();
    const first = accept(queue, 'p1', exitStart(12));
    expect(first.status).toBe('accepted');
    const again = accept(queue, 'p1', exitStart(12));
    expect(again).toMatchObject({ status: 'duplicate', outcome: null });
    expect(queue.freeze()).toHaveLength(1);
    expect(queue.freeze()).toHaveLength(0);
    const completed = queue.complete(
      uuid(12),
      { result: 'rejected', code: 'NOT_ALLOWED', tick: 101 },
      40,
      10,
    );
    expect(completed).toEqual({
      actorId: 'p1',
      outcome: {
        matchId: 'match-1',
        requestId: uuid(12),
        sequence: 12,
        tick: 101,
        stateVersion: 40,
        result: 'rejected',
        code: 'NOT_ALLOWED',
      },
    });
    expect(
      queue.complete(uuid(12), { result: 'applied', code: null, tick: 102 }, 41, 11),
    ).toBeNull();
    const replay = accept(queue, 'p1', exitStart(12));
    expect(replay).toMatchObject({ status: 'duplicate', outcome: completed!.outcome });
    expect(queue.status('p1', 'match-1', uuid(12))).toEqual({
      matchId: 'match-1',
      requestId: uuid(12),
      status: 'done',
      outcome: completed!.outcome,
    });
    expect(accept(queue, 'p1', { ...exitStart(12), payload: { exitId: 'exit-2' } })).toEqual({
      status: 'rejected',
      code: 'STALE_REQUEST',
    });
    expect(accept(queue, 'p1', { ...exitStart(13), requestId: uuid(12) })).toEqual({
      status: 'rejected',
      code: 'STALE_REQUEST',
    });
    expect(accept(queue, 'p2', exitStart(12))).toEqual({
      status: 'rejected',
      code: 'STALE_REQUEST',
    });
    expect(accept(queue, 'p1', move(11))).toEqual({ status: 'rejected', code: 'STALE_REQUEST' });
  });

  it('enforces 64 pending per actor and 384 per room without evicting pending entries', () => {
    const queue = new CommandQueue();
    for (let i = 1; i <= 64; i++) expect(accept(queue, 'p1', move(i)).status).toBe('accepted');
    expect(accept(queue, 'p1', move(65))).toEqual({ status: 'rejected', code: 'QUEUE_FULL' });
    expect(queue.pendingCount('p1')).toBe(64);
    ['p2', 'p3', 'p4', 'p5', 'p6'].forEach((actor, index) => {
      for (let i = 1; i <= 64; i++) {
        const command = { ...move(i), requestId: uuid(1000 * (index + 1) + i) };
        expect(accept(queue, actor, command).status).toBe('accepted');
      }
    });
    expect(queue.pendingCount()).toBe(384);
    expect(accept(queue, 'p7', { ...move(1), requestId: uuid(9999) })).toEqual({
      status: 'rejected',
      code: 'QUEUE_FULL',
    });
    expect(queue.pendingCount()).toBe(384);
  });

  it('expires held moves after 500ms of real time exactly once and cancels stale queued moves', () => {
    const queue = new CommandQueue();
    accept(queue, 'p1', move(1), 0);
    queue.freeze();
    queue.complete(uuid(1), { result: 'applied', code: null, tick: 1 }, 41, 0);
    expect(queue.expireHeldMoves(500)).toEqual([]);
    expect(queue.expireHeldMoves(501)).toEqual([
      { type: 'EXPIRE_MOVE', playerId: 'p1', sequence: 1 },
    ]);
    expect(queue.expireHeldMoves(900)).toEqual([]);
    // A queued move that already aged past the TTL is canceled before the core sees it.
    accept(queue, 'p1', move(2), 1000);
    expect(queue.expiredQueuedMoves(1500)).toHaveLength(0);
    expect(queue.expiredQueuedMoves(1501).map((entry) => entry.command.sequence)).toEqual([2]);
    const canceled = queue.cancelPending(
      'EXPIRED',
      30,
      () => 41,
      1501,
      (entry) => entry.command.sequence === 2,
    );
    expect(canceled[0]?.outcome).toMatchObject({
      result: 'canceled',
      code: 'EXPIRED',
      sequence: 2,
    });
    expect(queue.freeze()).toEqual([]);
    // Releasing a held move (direction null) stops expiry.
    accept(queue, 'p1', move(3, null), 2000);
    queue.freeze();
    queue.complete(uuid(3), { result: 'applied', code: null, tick: 40 }, 42, 2000);
    expect(queue.expireHeldMoves(9000)).toEqual([]);
  });

  it('cancels every pending request at match end once and never re-cancels applied ones', () => {
    const queue = new CommandQueue();
    for (let i = 1; i <= 4; i++) accept(queue, 'p1', move(i));
    queue.freeze();
    queue.complete(uuid(1), { result: 'applied', code: null, tick: 5 }, 41, 0);
    const canceled = queue.cancelPending('ROUND_ENDED', 6, () => 41, 0);
    expect(canceled.map((c) => c.outcome.sequence)).toEqual([2, 3, 4]);
    expect(
      canceled.every((c) => c.outcome.result === 'canceled' && c.outcome.code === 'ROUND_ENDED'),
    ).toBe(true);
    expect(queue.pendingCount()).toBe(0);
    expect(queue.cancelPending('ROUND_ENDED', 7, () => 41, 0)).toEqual([]);
    expect(queue.status('p1', 'match-1', uuid(1)).outcome).toMatchObject({ result: 'applied' });
    expect(queue.status('p2', 'match-1', uuid(1))).toEqual({
      matchId: 'match-1',
      requestId: uuid(1),
      status: 'unknown',
      outcome: null,
    });
    queue.reset();
    expect(queue.status('p1', 'match-1', uuid(1)).status).toBe('unknown');
  });

  it('bounds completed history at 512 per actor and 2 minutes while keeping pending entries', () => {
    const queue = new CommandQueue();
    for (let i = 1; i <= 513; i++) {
      accept(queue, 'p1', move(i), i);
      queue.freeze();
      queue.complete(uuid(i), { result: 'applied', code: null, tick: i }, 41, i);
    }
    expect(queue.completedCount('p1')).toBe(512);
    expect(queue.status('p1', 'match-1', uuid(1)).status).toBe('unknown');
    expect(queue.status('p1', 'match-1', uuid(2)).status).toBe('done');
    accept(queue, 'p1', move(600), 1000);
    expect(queue.pendingCount()).toBe(1);
    queue.pruneCompleted(1000 + 120_000);
    expect(queue.completedCount('p1')).toBe(0);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.status('p1', 'match-1', uuid(600)).status).toBe('pending');
    // Pruned history does not re-open execution: an old sequence stays stale.
    expect(accept(queue, 'p1', move(2))).toEqual({ status: 'rejected', code: 'STALE_REQUEST' });
  });
});
