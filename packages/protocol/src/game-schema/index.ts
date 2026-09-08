import { schema, t, type SchemaType } from '@colyseus/schema';

export * from './product.js';

/*
 * Everything below is the 0.1 development room contract kept for the team's regression flow.
 * It is not the product contract and production must not register a room that sends it.
 */

export const Player = schema(
  {
    id: t.string().default(''),
    role: t.string<'runner' | 'tagger'>().default('runner'),
    x: t.uint8().default(0),
    y: t.uint8().default(0),
    dir: t.uint8<0 | 1 | 2 | 3>().default(0),
    status: t.string<'alive' | 'escaped' | 'captured'>().default('alive'),
    trapped: t.boolean().default(false),
    ready: t.boolean().default(false),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

export const Exit = schema(
  {
    ownerId: t.string().default(''),
    wallX: t.uint8().default(0),
    wallY: t.uint8().default(0),
    side: t.uint8<0 | 1 | 2 | 3>().default(0),
    approachX: t.uint8().default(0),
    approachY: t.uint8().default(0),
    open: t.boolean().default(true),
  },
  'Exit',
);
export type Exit = SchemaType<typeof Exit>;

export const GameState = schema(
  {
    phase: t.string<'waiting' | 'prep' | 'countdown' | 'playing' | 'result'>().default('waiting'),
    tick: t.number().default(0),
    timeLeft: t.number().default(0),
    roomCode: t.string().default(''),
    /** Development stub: the full 32*32 map remains public to every player. */
    maze: t.array('uint8'),
    players: t.map(Player),
    /** Runner-specific exits are absent unless their StateView includes an Exit. */
    exits: t.map(Exit).view(),
  },
  'GameState',
);
export type GameState = SchemaType<typeof GameState>;
