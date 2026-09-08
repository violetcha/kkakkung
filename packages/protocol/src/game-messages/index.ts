import { z } from 'zod';

export * from './product.js';
export * from './session.js';
export * from './heartbeat.js';
export * from './events.js';
export * from './room.js';
export * from './media.js';

/*
 * Development 0.1 kkakkung room messages. Kept only for the team's regression room and never
 * mixed with the 0.2.0 product `command` channel.
 */
const sequenceSchema = z.number().int().nonnegative().safe();

export const teamMoveSchema = z.strictObject({
  seq: sequenceSchema,
  dir: z.enum(['forward', 'back']),
});

export const teamTurnSchema = z.strictObject({
  seq: sequenceSchema,
  dir: z.enum(['left', 'right']),
});

export const teamReadySchema = z.strictObject({});

export type TeamMove = z.infer<typeof teamMoveSchema>;
export type TeamTurn = z.infer<typeof teamTurnSchema>;
