/** Product session HTTP contract (`POST /api/sessions`) and product room join options. */
import { z } from 'zod';
import { PRODUCT_PROTOCOL_VERSION } from '../version.js';

export const SESSION_ROUTE = '/api/sessions';
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export const nicknameSchema = z.string().min(1).max(20);
export const inviteTokenSchema = z.string().min(16).max(512);
export const roomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);

export const sessionRequestSchema = z.discriminatedUnion('createRoom', [
  z.strictObject({
    nickname: nicknameSchema,
    inviteToken: inviteTokenSchema,
    createRoom: z.literal(true),
  }),
  z.strictObject({
    nickname: nicknameSchema,
    inviteToken: inviteTokenSchema,
    createRoom: z.literal(false),
    roomCode: roomCodeSchema,
  }),
]);
export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const sessionResponseSchema = z.strictObject({
  sessionToken: z.string().min(1),
  playerId: z.string().min(1),
  roomCode: roomCodeSchema,
  /** Epoch milliseconds. Not the server monotonic clock. */
  expiresAt: z.number().int().positive().safe(),
  protocolVersion: z.literal(PRODUCT_PROTOCOL_VERSION),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Safe HTTP error codes for the session route. No hidden room content is ever returned. */
export const SESSION_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_INVITATION',
  'ROOM_NOT_AVAILABLE',
  'RATE_LIMITED',
  'ADMISSION_CLOSED',
  'CAPACITY',
] as const;
export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

export const productJoinOptionsSchema = z.strictObject({
  token: z.string().min(1),
  roomCode: roomCodeSchema,
  protocolVersion: z.string(),
});
export type ProductJoinOptions = z.infer<typeof productJoinOptionsSchema>;
