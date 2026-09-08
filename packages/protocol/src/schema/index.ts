import { schema, t, type SchemaType } from '@colyseus/schema';

import { PROTOCOL_VERSION } from '../version.js';

export const PlayerState = schema(
  {
    playerId: t.string().default(''),
    nickname: t.string().default(''),
    x: t.number().default(0),
    z: t.number().default(0),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const SandboxState = schema(
  {
    protocolVersion: t.string().default(PROTOCOL_VERSION),
    phase: t.string().default('sandbox'),
    tick: t.number().default(0),
    players: t.map(PlayerState),
  },
  'SandboxState',
);
export type SandboxState = SchemaType<typeof SandboxState>;
