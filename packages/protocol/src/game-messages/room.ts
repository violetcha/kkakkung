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
  /** 방의 종류. 없으면 일반 6인 경기다. 시연 방(showcase)은 4인 2:2 로, 화면이 자리 수를 여기서 읽는다. */
  kind: z.enum(['match', 'demo', 'showcase']).optional(),
  /** 방이 채워야 하는 자리 수. 없으면 6. */
  capacity: z.number().int().min(1).max(6).optional(),
});
export type RoomRosterMessage = z.infer<typeof roomRosterSchema>;
export type RoomKind = NonNullable<RoomRosterMessage['kind']>;
/** Application close code for an expired waiting/result room. */
export const ROOM_EXPIRED_CLOSE_CODE = 4001;
/** Host removal during waiting phases; the old logical session is invalidated. */
export const ROOM_REMOVED_CLOSE_CODE = 4002;
/**
 * S15P21C204-363. 시연 방의 방장이 대기실(LOBBY·DEVICE_CHECK)에서 나가 방이 통째로 닫혔다. 남은
 * 참가자는 이 코드로 끊기고 `/showcase` 첫 화면으로 돌아간다. 일반 방은 방장을 승계하므로 쓰지 않는다.
 */
export const SHOWCASE_CLOSED_CLOSE_CODE = 4003;
/** Separate additive channel so older clients can still consume the unchanged roster. */
export const roomAccessSchema = z.strictObject({
  matchId: matchIdSchema,
  revision: z.number().int().nonnegative().safe(),
  locked: z.boolean(),
});
export type RoomAccessMessage = z.infer<typeof roomAccessSchema>;
/**
 * S15P21C204-311. 방이 고른 맵 크기. roomAccess 와 같은 이유로 별도 채널이다 — 예전 클라이언트는
 * 바뀌지 않은 roster 를 그대로 읽는다. 방장만 바꿀 수 있다. 일반·데모 방은 LOBBY·DEVICE_CHECK
 * 에서 바뀌고(313), 시연 방은 소형 맵 고정이라 어디서도 받지 않는다.
 */
export const roomMapSchema = z.strictObject({
  matchId: matchIdSchema,
  revision: z.number().int().nonnegative().safe(),
  size: z.enum(MAP_SIZES),
});
export type RoomMapMessage = z.infer<typeof roomMapSchema>;
