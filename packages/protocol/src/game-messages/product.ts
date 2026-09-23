/**
 * Product (0.2.0) command channel contract: strict envelopes, receipts, outcomes and
 * request-status lookups. Only the active EXEC-CONTRACT-3 command union is defined here.
 * Undecided item content has no command, enum or placeholder in this file.
 */
import { z } from 'zod';
import { MAP_SIZES } from '../game-schema/product.js';

export const MAX_COMMAND_BYTES = 4096;

export const PRODUCT_CLIENT_MESSAGES = {
  command: 'command',
  requestStatus: 'request-status',
  viewResync: 'view-resync',
  heartbeatAck: 'game-heartbeat-ack',
  clockProbe: 'clock-probe',
  mediaBindingsRefresh: 'media-bindings-refresh',
  /** Operator-only demo room (S15P21C204-259). Ordinary rooms refuse it. */
  demoScenario: 'demo-scenario',
  /** Operator-only demo room control (S15P21C204-318). */
  demoControl: 'demo-control',
} as const;

export const PRODUCT_SERVER_MESSAGES = {
  commandResult: 'command-result',
  commandOutcome: 'command-outcome',
  requestStatusResult: 'request-status-result',
  roomRoster: 'room-roster',
  roomAccess: 'room-access',
  /** S15P21C204-311. 방이 고른 맵 크기. */
  roomMap: 'room-map',
  privateView: 'private-view',
  privateEvent: 'private-event',
  heartbeat: 'game-heartbeat',
  clockReply: 'clock-reply',
  mediaBindings: 'media-bindings',
  audioPolicy: 'audio-policy',
  /** Operator-only demo room: which scenarios exist and what is running. */
  demoState: 'demo-state',
} as const;

export const COMMAND_CODES = [
  'INVALID_COMMAND',
  'PROTOCOL_MISMATCH',
  'WRONG_MATCH',
  'RATE_LIMITED',
  'INVALID_PHASE',
  'NOT_ACTIVE',
  'NOT_ALLOWED',
  'EXPIRED',
  'STALE_REQUEST',
  'NOT_READY',
  'QUEUE_FULL',
  'ROUND_ENDED',
  'CANCELED',
] as const;
export const commandCodeSchema = z.enum(COMMAND_CODES);
export type CommandCode = z.infer<typeof commandCodeSchema>;

export const matchIdSchema = z.string().min(1).max(64);
export const requestIdSchema = z.uuid();
export const sequenceSchema = z.number().int().nonnegative().safe();
export const tickSchema = z.number().int().nonnegative().safe();
export const stateVersionSchema = z.number().int().nonnegative().safe();
const playerIdSchema = z.string().min(1).max(64);
const opaqueIdSchema = z.string().min(1).max(128);
export const equipmentKindSchema = z.enum(['sensor', 'trap']);

const base = { matchId: matchIdSchema, requestId: requestIdSchema, sequence: sequenceSchema };
const envelope = <T extends string, P extends z.ZodRawShape>(type: T, payload: P) =>
  z.strictObject({ ...base, type: z.literal(type), payload: z.strictObject(payload) });

export const commandEnvelopeSchema = z.discriminatedUnion('type', [
  envelope('MOVE_INTENT', { direction: z.enum(['forward', 'back']).nullable() }),
  envelope('TURN', { direction: z.enum(['left', 'right']) }),
  envelope('GRAB_INTENT', {}),
  envelope('READY', { ready: z.boolean() }),
  envelope('ROOM_LOCK', { locked: z.boolean() }),
  envelope('ROOM_KICK', { targetPlayerId: playerIdSchema }),
  /** S15P21C204-311. 방장이 로비에서 맵 크기를 고른다. */
  envelope('ROOM_MAP_SIZE', { size: z.enum(MAP_SIZES) }),
  /** S15P21C204-295. 여섯 명이 모두 준비한 뒤, 방장이 직접 시작한다. */
  envelope('ROOM_START', {}),
  envelope('PRACTICE_READY', { ready: z.boolean() }),
  envelope('LOAD_READY', {
    loadId: opaqueIdSchema,
    mediaInstanceId: opaqueIdSchema,
    receiverGeneration: z.number().int().nonnegative().safe(),
  }),
  envelope('EXCHANGE_REQUEST', { targetPlayerId: playerIdSchema }),
  envelope('EXCHANGE_ACCEPT', { exchangeId: opaqueIdSchema }),
  envelope('EXCHANGE_CANCEL', { exchangeId: opaqueIdSchema }),
  envelope('INSTALL', { kind: equipmentKindSchema }),
  envelope('INSTALL_CANCEL', { installationId: opaqueIdSchema }),
  envelope('EXIT_START', { exitId: opaqueIdSchema }),
  envelope('EXIT_CANCEL', { challengeId: opaqueIdSchema }),
  envelope('EXIT_PROGRESS', {
    challengeId: opaqueIdSchema,
    method: z.enum(['pose', 'keys']),
    completed: z.boolean(),
  }),
  envelope('REMATCH', {
    mode: z.enum(['same', 'swap', 'lobby']),
    /** Only demo rooms accept role; ordinary rooms reject the field at the room boundary. */
    role: z.enum(['runner', 'tagger']).optional(),
  }),
  /** S15P21C204-269. An ended runner picks which surviving runner to watch. */
  envelope('SPECTATE', { targetPlayerId: playerIdSchema }),
]);
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type CommandType = CommandEnvelope['type'];
export type CommandPayloads = {
  [K in CommandType]: Extract<CommandEnvelope, { type: K }>['payload'];
};
export const COMMAND_TYPES = commandEnvelopeSchema.options.map(
  (option) => option.shape.type.value,
) as readonly CommandType[];

/** Commands the game core processes. The rest are room phase commands handled by the server. */
export const PHASE_COMMAND_TYPES = [
  'READY',
  'ROOM_LOCK',
  'ROOM_KICK',
  'ROOM_MAP_SIZE',
  'ROOM_START',
  'PRACTICE_READY',
  'LOAD_READY',
  'REMATCH',
  'SPECTATE',
] as const;
export type PhaseCommandType = (typeof PHASE_COMMAND_TYPES)[number];
export type CoreCommandType = Exclude<CommandType, PhaseCommandType>;
export type CoreCommandEnvelope = Extract<CommandEnvelope, { type: CoreCommandType }>;
export type PhaseCommandEnvelope = Extract<CommandEnvelope, { type: PhaseCommandType }>;
export const isPhaseCommand = (command: CommandEnvelope): command is PhaseCommandEnvelope =>
  (PHASE_COMMAND_TYPES as readonly string[]).includes(command.type);

const receiptBase = { ...base, stateVersion: stateVersionSchema };
export const commandReceiptSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...receiptBase, status: z.literal('accepted'), code: z.null() }),
  z.strictObject({ ...receiptBase, status: z.literal('rejected'), code: commandCodeSchema }),
]);
export type CommandReceipt = z.infer<typeof commandReceiptSchema>;

const outcomeBase = { ...base, tick: tickSchema, stateVersion: stateVersionSchema };
export const commandOutcomeSchema = z.discriminatedUnion('result', [
  z.strictObject({ ...outcomeBase, result: z.literal('applied'), code: z.null() }),
  z.strictObject({ ...outcomeBase, result: z.literal('rejected'), code: commandCodeSchema }),
  z.strictObject({ ...outcomeBase, result: z.literal('canceled'), code: commandCodeSchema }),
]);
export type CommandOutcome = z.infer<typeof commandOutcomeSchema>;

export const requestStatusSchema = z.strictObject({
  matchId: matchIdSchema,
  requestId: requestIdSchema,
});
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const requestStatusResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    matchId: matchIdSchema,
    requestId: requestIdSchema,
    status: z.literal('done'),
    outcome: commandOutcomeSchema,
  }),
  z.strictObject({
    matchId: matchIdSchema,
    requestId: requestIdSchema,
    status: z.literal('pending'),
    outcome: z.null(),
  }),
  z.strictObject({
    matchId: matchIdSchema,
    requestId: requestIdSchema,
    status: z.literal('unknown'),
    outcome: z.null(),
  }),
]);
export type RequestStatusResult = z.infer<typeof requestStatusResultSchema>;

/** UTF-8 byte length of a string, computed from code points so no DOM/Node encoder is needed. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** UTF-8 byte length of the JSON encoding. Non-serializable input counts as oversized. */
export function measureJsonBytes(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? Number.POSITIVE_INFINITY : utf8ByteLength(text);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Best-effort correlation for a receipt when a payload is rejected before validation.
 * Unknown or unsafe values fall back to '' / -1 so a rejection never echoes attacker data.
 */
export function correlateRejectedCommand(payload: unknown): {
  matchId: string;
  requestId: string;
  sequence: number;
} {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const matchId = matchIdSchema.safeParse(record.matchId);
  const requestId = requestIdSchema.safeParse(record.requestId);
  const sequence = sequenceSchema.safeParse(record.sequence);
  return {
    matchId: matchId.success ? matchId.data : '',
    requestId: requestId.success ? requestId.data : '',
    sequence: sequence.success ? sequence.data : -1,
  };
}

/**
 * Operator-only demo room messages (S15P21C204-259). The scenario list is server-owned; the
 * client picks one of the ids it was given and never describes the choreography itself.
 */
export const DEMO_SCENARIO_IDS = [
  // S15P21C204-317. 서버의 `DEMO_SCENARIOS` 와 같은 순서·같은 값이다. 대본이 늘면 여기도
  // 함께 는다. 배치 두 개는 관리자를 걷지 않고 확인 자리로 보내고, 그 밖의 새 대본은
  // 관리자가 주도하는 기능(내 장비·내 요청·내 도전)을 인형이 받아 주는 것들이다.
  'place-me-at-exit',
  'place-puppet',
  'approach',
  'cross-my-view',
  'turn-before-me',
  'trap',
  'sensor',
  'device-states',
  'double-trap-immunity',
  'capture',
  'capture-one',
  'capture-in-challenge',
  'caught-in-my-challenge',
  'exit',
  'exchange',
  'exchange-cancel',
  'accept-my-exchange',
  'exchange-trace',
  'spectate-then-capture',
  'result-tagger-win',
  'result-runner-win',
  'abort-connection-lost',
] as const;
export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];
const demoScenarioOptionKeySchema = z.enum(['role', 'distance', 'side', 'facing', 'installer']);
export const demoScenarioOptionsSchema = z.strictObject({
  role: z.enum(['runner', 'tagger']).optional(),
  distance: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .optional(),
  side: z.enum(['front', 'left', 'right', 'back']).optional(),
  facing: z.enum(['toward', 'away']).optional(),
  installer: z.enum(['puppet', 'me']).optional(),
});
export type DemoScenarioOptions = z.infer<typeof demoScenarioOptionsSchema>;
export const demoScenarioRequestSchema = z.strictObject({
  matchId: matchIdSchema,
  scenario: z.enum(DEMO_SCENARIO_IDS),
  options: demoScenarioOptionsSchema.optional(),
});
export type DemoScenarioRequest = z.infer<typeof demoScenarioRequestSchema>;
export const demoControlSchema = z.strictObject({
  matchId: matchIdSchema,
  /**
   * S15P21C204-342. `cancel-scenario` 는 도는 대본만 내린다. 관리자를 기다리는 대본이 2분 동안
   * 다른 버튼을 잠그던 것을 라운드를 끝내지 않고 풀 수 있다.
   */
  action: z.enum(['abort-round', 'cancel-scenario']),
});
export type DemoControl = z.infer<typeof demoControlSchema>;
export const demoAvailableScenarioSchema = z.strictObject({
  id: z.enum(DEMO_SCENARIO_IDS),
  options: z.array(demoScenarioOptionKeySchema).max(5),
  /**
   * S15P21C204-342. 지금은 시작할 수 없는 이유(서버의 거절 코드). 있으면 버튼은 잠긴 채 이유와
   * 함께 남는다. 목록에서 조용히 사라지면 관리자가 무엇이 없어졌는지 알 수 없다. 코드 목록은
   * 서버(`DemoScenarios.ts`)가 쥐고 웹이 라벨을 붙이므로 여기서는 길이만 제한한다.
   */
  unavailable: z.string().max(64).optional(),
});
export type DemoAvailableScenario = z.infer<typeof demoAvailableScenarioSchema>;
export const demoStateSchema = z.strictObject({
  matchId: matchIdSchema,
  available: z.array(demoAvailableScenarioSchema).max(DEMO_SCENARIO_IDS.length),
  running: z.enum(DEMO_SCENARIO_IDS).nullable(),
  step: z.string().max(128).nullable(),
  /** Why the last scenario stopped early, in a short code. Cleared when a new one starts. */
  failureCode: z.string().max(128).nullable(),
  /** S15P21C204-342. 마지막으로 끝까지 간 대본. 실패·취소로 끝났으면 null 이다. */
  completed: z.enum(DEMO_SCENARIO_IDS).nullable().default(null),
  /**
   * 대본이 끝날 때마다 오르는 번호(성공·실패·취소 모두). 같은 이유로 다시 거절돼 문구가 같아도
   * 화면이 "또 눌렀다"를 알 수 있다.
   */
  outcomeSeq: z.number().int().min(0).default(0),
  operatorExit: z.strictObject({ x: z.number().int(), y: z.number().int() }).nullable(),
});
export type DemoStateMessage = z.infer<typeof demoStateSchema>;
