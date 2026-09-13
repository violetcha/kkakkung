import { describe, expect, it } from 'vitest';

import {
  COMMAND_TYPES,
  MAX_COMMAND_BYTES,
  PHASE_COMMAND_TYPES,
  commandEnvelopeSchema,
  commandOutcomeSchema,
  commandReceiptSchema,
  correlateRejectedCommand,
  isPhaseCommand,
  measureJsonBytes,
  requestStatusResultSchema,
  requestStatusSchema,
  utf8ByteLength,
} from '../src/game-messages/product.js';

const requestId = '10000000-0000-4000-8000-000000000001';
const move = {
  matchId: 'match-1',
  requestId,
  sequence: 3,
  type: 'MOVE_INTENT',
  payload: { direction: 'forward' },
};

describe('product command envelope', () => {
  it('defines exactly the active EXEC-CONTRACT-3 command union', () => {
    expect([...COMMAND_TYPES].sort()).toEqual(
      [
        'MOVE_INTENT',
        'TURN',
        'READY',
        'ROOM_LOCK',
        'ROOM_KICK',
        'PRACTICE_READY',
        'LOAD_READY',
        'EXCHANGE_REQUEST',
        'EXCHANGE_ACCEPT',
        'EXCHANGE_CANCEL',
        'INSTALL',
        'INSTALL_CANCEL',
        'EXIT_START',
        'EXIT_CANCEL',
        'EXIT_PROGRESS',
        'REMATCH',
      ].sort(),
    );
    expect(COMMAND_TYPES).not.toContain('USE_ITEM');
    expect(PHASE_COMMAND_TYPES).toEqual([
      'READY',
      'ROOM_LOCK',
      'ROOM_KICK',
      'PRACTICE_READY',
      'LOAD_READY',
      'REMATCH',
    ]);
  });

  it('accepts documented envelopes and classifies phase commands', () => {
    const parsed = commandEnvelopeSchema.parse(move);
    expect(parsed).toEqual(move);
    expect(isPhaseCommand(parsed)).toBe(false);
    expect(
      isPhaseCommand(
        commandEnvelopeSchema.parse({ ...move, type: 'READY', payload: { ready: true } }),
      ),
    ).toBe(true);
    expect(
      commandEnvelopeSchema.parse({ ...move, payload: { direction: null } }).payload.direction,
    ).toBeNull();
    expect(
      commandEnvelopeSchema.parse({
        ...move,
        type: 'INSTALL_CANCEL',
        payload: { installationId: 'install-1' },
      }).type,
    ).toBe('INSTALL_CANCEL');
  });

  it('classifies host commands as phase commands and rejects spoofed identity or malformed targets', () => {
    for (const [type, payload] of [
      ['ROOM_LOCK', { locked: true }],
      ['ROOM_KICK', { targetPlayerId: 'friend' }],
    ]) {
      expect(isPhaseCommand(commandEnvelopeSchema.parse({ ...move, type, payload }))).toBe(true);
      expect(
        commandEnvelopeSchema.safeParse({ ...move, type, payload, actorId: 'host' }).success,
      ).toBe(false);
    }
    expect(
      commandEnvelopeSchema.safeParse({
        ...move,
        type: 'ROOM_KICK',
        payload: { targetPlayerId: '' },
      }).success,
    ).toBe(false);
    expect(
      commandEnvelopeSchema.safeParse({ ...move, type: 'ROOM_LOCK', payload: { locked: 'true' } })
        .success,
    ).toBe(false);
  });

  it.each([
    { name: 'legacy seq only', payload: { seq: 1, dir: 'forward' } },
    { name: 'fractional sequence', payload: { ...move, sequence: 1.5 } },
    { name: 'negative sequence', payload: { ...move, sequence: -1 } },
    { name: 'unsafe sequence', payload: { ...move, sequence: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'malformed uuid', payload: { ...move, requestId: 'not-a-uuid' } },
    { name: 'extra coordinate', payload: { ...move, payload: { direction: 'forward', x: 3 } } },
    { name: 'client player id', payload: { ...move, playerId: 'forged' } },
    { name: 'unknown type', payload: { ...move, type: 'USE_ITEM', payload: {} } },
    { name: 'invalid direction', payload: { ...move, payload: { direction: 'sideways' } } },
    {
      name: 'install cancel without id',
      payload: { ...move, type: 'INSTALL_CANCEL', payload: {} },
    },
    {
      name: 'exchange accept extra field',
      payload: { ...move, type: 'EXCHANGE_ACCEPT', payload: { exchangeId: 'e', team: 1 } },
    },
  ])('rejects $name', ({ payload }) => {
    expect(commandEnvelopeSchema.safeParse(payload).success).toBe(false);
  });

  it('measures payload size in UTF-8 bytes rather than characters', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('가')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    const oversized = { ...move, payload: { direction: 'forward' }, matchId: '가'.repeat(1400) };
    expect(measureJsonBytes(oversized)).toBeGreaterThan(MAX_COMMAND_BYTES);
    expect(oversized.matchId.length).toBeLessThan(MAX_COMMAND_BYTES);
    expect(measureJsonBytes(move)).toBeLessThan(MAX_COMMAND_BYTES);
  });

  it('correlates malformed input safely for receipts', () => {
    expect(correlateRejectedCommand({ seq: 1 })).toEqual({
      matchId: '',
      requestId: '',
      sequence: -1,
    });
    expect(correlateRejectedCommand({ matchId: 'm', requestId, sequence: 4 })).toEqual({
      matchId: 'm',
      requestId,
      sequence: 4,
    });
    expect(correlateRejectedCommand(null).sequence).toBe(-1);
  });

  it('shapes receipts, outcomes and request status results strictly', () => {
    const accepted = {
      matchId: 'm',
      requestId,
      sequence: 1,
      stateVersion: 3,
      status: 'accepted',
      code: null,
    };
    expect(commandReceiptSchema.parse(accepted)).toEqual(accepted);
    expect(commandReceiptSchema.safeParse({ ...accepted, code: 'QUEUE_FULL' }).success).toBe(false);
    expect(
      commandReceiptSchema.safeParse({ ...accepted, status: 'rejected', code: null }).success,
    ).toBe(false);
    const outcome = {
      matchId: 'm',
      requestId,
      sequence: 1,
      tick: 9,
      stateVersion: 3,
      result: 'rejected',
      code: 'NOT_ALLOWED',
    };
    expect(commandOutcomeSchema.parse(outcome)).toEqual(outcome);
    expect(commandOutcomeSchema.safeParse({ ...outcome, result: 'applied' }).success).toBe(false);
    expect(commandOutcomeSchema.safeParse({ ...outcome, actorId: 'p1' }).success).toBe(false);
    expect(requestStatusSchema.safeParse({ matchId: 'm', requestId, playerId: 'p' }).success).toBe(
      false,
    );
    expect(
      requestStatusResultSchema.parse({ matchId: 'm', requestId, status: 'done', outcome }),
    ).toBeTruthy();
    expect(
      requestStatusResultSchema.safeParse({ matchId: 'm', requestId, status: 'pending', outcome })
        .success,
    ).toBe(false);
    expect(
      requestStatusResultSchema.parse({ matchId: 'm', requestId, status: 'unknown', outcome: null })
        .status,
    ).toBe('unknown');
  });
});
