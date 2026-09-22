/** Product session HTTP contract (`POST /api/sessions`) and product room join options. */
import { z } from 'zod';
import { PRODUCT_PROTOCOL_VERSION } from '../version.js';

export const SESSION_ROUTE = '/api/sessions';
/** Request-scoped hint only; POST independently validates identity and invitation scope. */
export const SESSION_ACCESS_ROUTE = '/api/sessions/access';
export const sessionAccessResponseSchema = z.strictObject({
  method: z.enum(['invitation', 'gitlab-sso', 'guest']),
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

/**
 * Operator-only demo room (S15P21C204-258). The operator token opens a room whose other five
 * participants are server-driven puppets, so one person can show game situations that normally
 * need six. There is no player-facing route to it: the response carries the operator's own
 * session, and the room refuses ordinary admission.
 */
export const DEMO_ROOM_ROUTE = '/api/operations/demo-rooms';
/**
 * Browser-facing administrator entry. The host edge accepts this route only after GitLab SSO and
 * replaces the administrator identity header itself; it never accepts an operations Bearer from
 * a browser. The operations route above remains loopback-only for deployment tooling.
 */
export const DEMO_ADMIN_ROOM_ROUTE = '/api/demo-admin/rooms';
export const demoRoomRequestSchema = z.strictObject({
  role: z.enum(['runner', 'tagger']),
  nickname: nicknameSchema.optional(),
});
export type DemoRoomRequest = z.infer<typeof demoRoomRequestSchema>;
export const demoRoomResponseSchema = z.strictObject({
  sessionToken: z.string().min(1),
  playerId: z.string().min(1),
  roomCode: roomCodeSchema,
  role: z.enum(['runner', 'tagger']),
  expiresAt: z.number().int().positive().safe(),
  protocolVersion: z.literal(PRODUCT_PROTOCOL_VERSION),
  /** Ready-made address fragment for the operator: the page consumes and clears it on open. */
  entryFragment: z.string().min(1).max(1024),
});
export type DemoRoomResponse = z.infer<typeof demoRoomResponseSchema>;

/** Safe HTTP error codes for the session route. No hidden room content is ever returned. */
export const SESSION_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_INVITATION',
  'ROOM_NOT_AVAILABLE',
  'RATE_LIMITED',
  'ADMISSION_CLOSED',
  'CAPACITY',
  /**
   * 이 호출자가 이미 상한만큼 방을 열어 두었다(S15P21C204-293). 서비스가 찬 `CAPACITY` 와는
   * 다른 사실이라 따로 답한다: 여기서는 자기 방을 닫으면 바로 다시 열 수 있다.
   */
  'TOO_MANY_ROOMS',
] as const;
export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

export const productJoinOptionsSchema = z.strictObject({
  token: z.string().min(1),
  roomCode: roomCodeSchema,
  protocolVersion: z.string(),
});
export type ProductJoinOptions = z.infer<typeof productJoinOptionsSchema>;
