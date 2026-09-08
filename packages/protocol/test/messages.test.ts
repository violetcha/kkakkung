import { describe, expect, it } from 'vitest';

import {
  COMMAND_REJECTED_MESSAGE,
  MOVE_MESSAGE,
  commandRejectedSchema,
  devSessionRequestSchema,
  joinOptionsSchema,
  moveCommandSchema,
} from '../src/messages/index.js';

describe('protocol messages', () => {
  it('accepts the documented join options and rejects unknown keys', () => {
    expect(joinOptionsSchema.parse({ token: 'one-use-token', protocolVersion: '0.1.0' })).toEqual({
      token: 'one-use-token',
      protocolVersion: '0.1.0',
    });
    expect(() =>
      joinOptionsSchema.parse({
        token: 'one-use-token',
        protocolVersion: '0.1.0',
        extra: true,
      }),
    ).toThrow();
  });

  it.each(['', 'a'.repeat(21)])('rejects an invalid nickname %j', (nickname) => {
    expect(() => devSessionRequestSchema.parse({ nickname })).toThrow();
  });

  it('accepts nickname lengths at both boundaries', () => {
    expect(devSessionRequestSchema.parse({ nickname: 'a' })).toEqual({ nickname: 'a' });
    expect(devSessionRequestSchema.parse({ nickname: '가'.repeat(20) })).toEqual({
      nickname: '가'.repeat(20),
    });
  });

  it.each([
    { seq: -1, x: 0, z: 0 },
    { seq: 1.5, x: 0, z: 0 },
    { seq: Number.MAX_SAFE_INTEGER + 1, x: 0, z: 0 },
    { seq: 0, x: 1.01, z: 0 },
    { seq: 0, x: 0, z: -1.01 },
    { seq: 0, x: Number.NaN, z: 0 },
    { seq: 0, x: 0, z: Number.POSITIVE_INFINITY },
    { seq: 0, x: 0, z: 0, extra: true },
  ])('rejects an invalid move payload %#', (payload) => {
    expect(() => moveCommandSchema.parse(payload)).toThrow();
  });

  it('exports stable wire names and validates rejection events strictly', () => {
    expect(MOVE_MESSAGE).toBe('move');
    expect(COMMAND_REJECTED_MESSAGE).toBe('command-rejected');
    expect(commandRejectedSchema.parse({ code: 'stale-seq' })).toEqual({ code: 'stale-seq' });
    expect(() => commandRejectedSchema.parse({ code: 'stale-seq', detail: 'hidden' })).toThrow();
  });
});
