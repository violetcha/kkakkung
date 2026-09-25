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

/**
 * S15P21C204-401. 대기실에서 준비 완료한 사람의 얼굴을 보여 주는 사진 한 장. 대기실·장치 점검에는
 * 미디어(LiveKit)가 없다. 그 단계에 미디어를 열면 대기방 30개가 경기 10개 몫의 미디어 좌석을
 * 먼저 차지하므로, 가공 얼굴(흑백·저해상도) 사진 한 장만 게임 서버가 같은 방에 전한다. 서버는
 * 메모리에만 두고 나가면 지운다. 원본 카메라 영상은 이 길로 가지 않는다.
 */
export const LOBBY_FACE_MAX_CHARS = 6000;
export const LOBBY_FACE_SIZE_PX = 96;
const LOBBY_FACE_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export const lobbyFaceImageSchema = z.string().max(LOBBY_FACE_MAX_CHARS).regex(LOBBY_FACE_PATTERN);
/** 클라이언트 → 서버. 내 사진. */
export const lobbyFaceUploadSchema = z.strictObject({ image: lobbyFaceImageSchema });
export type LobbyFaceUpload = z.infer<typeof lobbyFaceUploadSchema>;
/** 서버 → 클라이언트. 다른 사람의 사진. null 이면 그 사람 사진을 지운다. */
export const lobbyFaceMessageSchema = z.strictObject({
  playerId: z.string().min(1).max(128),
  image: lobbyFaceImageSchema.nullable(),
});
export type LobbyFaceMessage = z.infer<typeof lobbyFaceMessageSchema>;
