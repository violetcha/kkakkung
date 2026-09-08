import { z } from 'zod';

export const MOVE_MESSAGE = 'move';
export const COMMAND_REJECTED_MESSAGE = 'command-rejected';

export const joinOptionsSchema = z.strictObject({
  token: z.string(),
  protocolVersion: z.string(),
});

export const devSessionRequestSchema = z.strictObject({
  nickname: z.string().min(1).max(20),
});

export const moveCommandSchema = z.strictObject({
  seq: z.number().int().nonnegative().safe(),
  x: z.number().finite().min(-1).max(1),
  z: z.number().finite().min(-1).max(1),
});

export const commandRejectedSchema = z.strictObject({
  code: z.string(),
});

export type JoinOptions = z.infer<typeof joinOptionsSchema>;
export type DevSessionRequest = z.infer<typeof devSessionRequestSchema>;
export type MoveMessage = z.infer<typeof moveCommandSchema>;
export type CommandRejectedEvent = z.infer<typeof commandRejectedSchema>;
