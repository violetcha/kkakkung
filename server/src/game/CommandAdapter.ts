import {
  MAX_COMMAND_BYTES,
  commandEnvelopeSchema,
  correlateRejectedCommand,
  isPhaseCommand,
  measureJsonBytes,
  type CommandCode,
  type CommandEnvelope,
  type CoreCommandEnvelope,
  type PhaseCommandEnvelope,
} from '@kkakkung/protocol/game-messages';
import { moveCommandSchema } from '@kkakkung/protocol/messages';
import type { MoveCommand } from '@kkakkung/game-core';
import type { CoreCommand } from './ports.js';

/** Sandbox (0.1.0) adapter kept for the diagnostic room. */
export function toMoveCommand(playerId: string, payload: unknown): MoveCommand | undefined {
  const parsed = moveCommandSchema.safeParse(payload);
  return parsed.success ? { playerId, ...parsed.data } : undefined;
}

export type Correlation = Readonly<{ matchId: string; requestId: string; sequence: number }>;

export type ProductCommandResult =
  | Readonly<{ status: 'accepted'; kind: 'core'; command: CoreCommandEnvelope }>
  | Readonly<{ status: 'accepted'; kind: 'phase'; command: PhaseCommandEnvelope }>
  | Readonly<{ status: 'rejected'; code: CommandCode; correlation: Correlation }>;

/**
 * Validates a raw product `command` payload: UTF-8 byte cap, strict envelope, current match.
 * Identity is never read from the payload; the caller injects the authenticated actor.
 */
export function toProductCommand(
  payload: unknown,
  context: { currentMatchId: string },
): ProductCommandResult {
  const correlation = correlateRejectedCommand(payload);
  if (measureJsonBytes(payload) > MAX_COMMAND_BYTES)
    return { status: 'rejected', code: 'INVALID_COMMAND', correlation };
  const parsed = commandEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return { status: 'rejected', code: 'INVALID_COMMAND', correlation };
  const command: CommandEnvelope = parsed.data;
  if (command.matchId !== context.currentMatchId)
    return { status: 'rejected', code: 'WRONG_MATCH', correlation: envelopeCorrelation(command) };
  return isPhaseCommand(command)
    ? { status: 'accepted', kind: 'phase', command }
    : { status: 'accepted', kind: 'core', command: command as CoreCommandEnvelope };
}

export function envelopeCorrelation(command: CommandEnvelope): Correlation {
  return { matchId: command.matchId, requestId: command.requestId, sequence: command.sequence };
}

/** Injects the authenticated actor into a core command. The wire never carries actorId. */
export function toCoreCommand(actorId: string, command: CoreCommandEnvelope): CoreCommand {
  return { ...command, actorId };
}
