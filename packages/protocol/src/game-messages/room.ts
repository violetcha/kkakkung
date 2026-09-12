/** Waiting-phase roster contract. Never a substitute for gameplay position or enemy roles. */
import { z } from 'zod';
import { PHASES } from '../game-schema/product.js';
import { matchIdSchema, stateVersionSchema } from './product.js';

export const roomRosterSchema = z.strictObject({
  matchId: matchIdSchema,
  stateVersion: stateVersionSchema,
  phase: z.enum(PHASES),
  hostId: z.string().min(1),
  players: z
    .array(
      z.strictObject({
        playerId: z.string().min(1),
        nickname: z.string().min(1).max(20),
        ready: z.boolean(),
        connected: z.boolean(),
      }),
    )
    .max(6),
});
export type RoomRosterMessage = z.infer<typeof roomRosterSchema>;
/** Application close code for an expired waiting/result room. */
export const ROOM_EXPIRED_CLOSE_CODE = 4001;
