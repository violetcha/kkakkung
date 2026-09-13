/** Product session HTTP contract (`POST /api/sessions`) and product room join options. */
import { z } from 'zod';
import { PRODUCT_PROTOCOL_VERSION } from '../version.js';

export const SESSION_ROUTE = '/api/sessions';
/** Request-scoped hint only; POST independently authenticates the trusted SSO request. */
export const SESSION_ACCESS_ROUTE = '/api/sessions/access';
export const sessionAccessResponseSchema = z.strictObject({
  method: z.enum(['invitation', 'gitlab-sso']),
});
export type SessionAccessResponse = z.infer<typeof sessionAccessResponseSchema>;
/** DELETE with the owner's Bearer token; never accepts a playerId or roomCode. */
export const SESSION_CANCEL_ROUTE = '/api/sessions/current';
export const sessionCancelRequestSchema = z.strictObject({});
export const SESSION_CANCEL_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_SESSION',
  'SESSION_IN_USE',
] as const;
export type SessionCancelErrorCode = (typeof SESSION_CANCEL_ERROR_CODES)[number];
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export const nicknameSchema = z.string().min(1).max(20);
export const inviteTokenSchema = z.string().min(16).max(512);
export const roomCodeSchema = z.string().regex(ROOM_CODE_PATTERN);

export const sessionRequestSchema = z.discriminatedUnion('createRoom', [
  z.strictObject({
    nickname: nicknameSchema,
    inviteToken: inviteTokenSchema.optional(),
    createRoom: z.literal(true),
  }),
  z.strictObject({
    nickname: nicknameSchema,
    inviteToken: inviteTokenSchema.optional(),
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

/** The connected lobby host manages only their current room. Never shares session credentials. */
export const ROOM_INVITATION_ROUTE = '/api/sessions/current/invitation';
export const roomInvitationRequestSchema = z.strictObject({});
export const roomInvitationResponseSchema = z.strictObject({
  inviteToken: inviteTokenSchema,
  roomCode: roomCodeSchema,
  expiresAt: z.number().int().positive().safe(),
});
export type RoomInvitationResponse = z.infer<typeof roomInvitationResponseSchema>;
export const ROOM_INVITATION_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_SESSION',
  'INVITATION_UNAVAILABLE',
  'RATE_LIMITED',
  'ADMISSION_CLOSED',
] as const;
export type RoomInvitationErrorCode = (typeof ROOM_INVITATION_ERROR_CODES)[number];

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
