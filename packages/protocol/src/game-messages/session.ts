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

/**
 * 발표 시연 방(showcase). 실제 사람 넷이 2:2 로 고정 소형 미로에서 3분을 온전히 뛰는 경기다.
 * `/showcase` 를 연 팀원이 모두 같은 방에 모이고, 역할은 각자 고른다. 진입은 `/demo` 와 같은
 * GitLab SSO 경계 뒤에 있고 브라우저에 운영 토큰은 전달되지 않는다.
 */
export const SHOWCASE_ROOM_ROUTE = '/api/showcase/rooms';
export const showcaseRoomRequestSchema = z.strictObject({
  role: z.enum(['runner', 'tagger']),
  nickname: nicknameSchema.optional(),
});
export type ShowcaseRoomRequest = z.infer<typeof showcaseRoomRequestSchema>;
export const showcaseRoomResponseSchema = z.strictObject({
  sessionToken: z.string().min(1),
  playerId: z.string().min(1),
  roomCode: roomCodeSchema,
  role: z.enum(['runner', 'tagger']),
  expiresAt: z.number().int().positive().safe(),
  protocolVersion: z.literal(PRODUCT_PROTOCOL_VERSION),
  /** 페이지가 열리며 소비·삭제하는 주소 조각. `#showcase=<token>&room=<code>&player=<id>`. */
  entryFragment: z.string().min(1).max(1024),
});
export type ShowcaseRoomResponse = z.infer<typeof showcaseRoomResponseSchema>;
/** 시연 방 발급 오류. ROLE_FULL 은 고른 역할 두 자리가 이미 찼다는 뜻이라 다른 역할로 다시 고른다. */
export const SHOWCASE_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'ROLE_FULL',
  'CAPACITY',
  'SHOWCASE_UNAVAILABLE',
  // S15P21C204-362. 서버가 입장을 받지 않는 동안(readiness LOCKED, admission 닫힘). 일반 세션 발급과 같다.
  'ADMISSION_CLOSED',
] as const;
export type ShowcaseErrorCode = (typeof SHOWCASE_ERROR_CODES)[number];

/** Safe HTTP error codes for the session route. No hidden room content is ever returned. */
export const SESSION_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_INVITATION',
  'ROOM_NOT_AVAILABLE',
  'RATE_LIMITED',
  'ADMISSION_CLOSED',
  /** 서비스가 찼다: 열 수 있는 방 수(`MAX_ROOMS`)나 좌석 수(`MAX_SLOTS`)를 다 썼다. 잠시 뒤 다시. */
  'CAPACITY',
  /**
   * S15P21C204-365. 들어가려던 그 방의 자리가 찼다. 서비스는 여유가 있을 수 있어 `CAPACITY` 와
   * 다르게 답한다: 여기서는 기다리는 것이 아니라 다른 방을 찾거나 새 방을 만든다.
   */
  'ROOM_FULL',
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
