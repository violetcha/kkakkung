import { moveCommandSchema } from '@kkakkung/protocol/messages';
import type { MoveCommand } from '@kkakkung/game-core';

export function toMoveCommand(playerId: string, payload: unknown): MoveCommand | undefined {
  const parsed = moveCommandSchema.safeParse(payload);
  return parsed.success ? { playerId, ...parsed.data } : undefined;
}
