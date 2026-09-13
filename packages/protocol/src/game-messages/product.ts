/**
 * Product (0.2.0) command channel contract: strict envelopes, receipts, outcomes and
 * request-status lookups. Only the active EXEC-CONTRACT-3 command union is defined here.
 * Undecided item content has no command, enum or placeholder in this file.
 */
import { z } from 'zod';

export const MAX_COMMAND_BYTES = 4096;

export const PRODUCT_CLIENT_MESSAGES = {
  command: 'command',
  requestStatus: 'request-status',
  viewResync: 'view-resync',
  heartbeatAck: 'game-heartbeat-ack',
  clockProbe: 'clock-probe',
  mediaBindingsRefresh: 'media-bindings-refresh',
} as const;

export const PRODUCT_SERVER_MESSAGES = {
  commandResult: 'command-result',
  commandOutcome: 'command-outcome',
  requestStatusResult: 'request-status-result',
  roomRoster: 'room-roster',
  roomAccess: 'room-access',
  privateView: 'private-view',
  privateEvent: 'private-event',
  heartbeat: 'game-heartbeat',
  clockReply: 'clock-reply',
  mediaBindings: 'media-bindings',
  audioPolicy: 'audio-policy',
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
  envelope('READY', { ready: z.boolean() }),
  envelope('ROOM_LOCK', { locked: z.boolean() }),
  envelope('ROOM_KICK', { targetPlayerId: playerIdSchema }),
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
  envelope('REMATCH', { mode: z.enum(['same', 'swap', 'lobby']) }),
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
  'PRACTICE_READY',
  'LOAD_READY',
  'REMATCH',
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
