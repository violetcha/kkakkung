/** Waiting-phase roster contract. Never a substitute for gameplay position or enemy roles. */
import { z } from 'zod';
import { MAP_SIZES, PHASES } from '../game-schema/product.js';
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
/** Host removal during waiting phases; the old logical session is invalidated. */
export const ROOM_REMOVED_CLOSE_CODE = 4002;
/** Separate additive channel so older clients can still consume the unchanged roster. */
export const roomAccessSchema = z.strictObject({
  matchId: matchIdSchema,
  revision: z.number().int().nonnegative().safe(),
  locked: z.boolean(),
});
export type RoomAccessMessage = z.infer<typeof roomAccessSchema>;
/**
 * S15P21C204-311. 방이 고른 맵 크기. roomAccess 와 같은 이유로 별도 채널이다 — 예전 클라이언트는
 * 바뀌지 않은 roster 를 그대로 읽는다. 방장만 바꿀 수 있고 LOBBY 에서만 바뀐다.
 */
export const roomMapSchema = z.strictObject({
  matchId: matchIdSchema,
  revision: z.number().int().nonnegative().safe(),
  size: z.enum(MAP_SIZES),
});
export type RoomMapMessage = z.infer<typeof roomMapSchema>;
