import { z } from 'zod';

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
