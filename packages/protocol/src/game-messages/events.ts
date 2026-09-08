/** Recipient-private events, private view and view resync contracts. */
import { z } from 'zod';
import { commandCodeSchema, matchIdSchema, stateVersionSchema, tickSchema } from './product.js';

export const FUTURE_EVENT_QUEUE_LIMIT = 64;
export const FUTURE_EVENT_WAIT_MS = 1000;
export const VIEW_RESYNC_LIMIT_PER_SECOND = 1;

const dirSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const cellSchema = z.strictObject({
  x: z.number().int().min(0).max(31),
  y: z.number().int().min(0).max(31),
});
const wallFaceSchema = cellSchema.extend({ side: dirSchema });
/** Half-cell trace points are allowed for exchange midpoints; not a Cell. */
const tracePointSchema = z.strictObject({
  x: z.number().finite().min(0).max(31),
  y: z.number().finite().min(0).max(31),
});
const idSchema = z.string().min(1).max(128);
const roleSchema = z.enum(['runner', 'tagger']);
const poseKindSchema = z.enum(['left', 'right', 'y']);
const equipmentKindSchema = z.enum(['sensor', 'trap']);
const armStateSchema = z.enum(['UNARMED', 'ARMED']);

export const activeGameScopeSchema = z.strictObject({
  gameInstanceId: idSchema,
  kind: z.enum(['practice', 'game']),
  revision: z.number().int().nonnegative().safe(),
});
export const gameViewScopeSchema = z.union([
  activeGameScopeSchema,
  z.strictObject({
    gameInstanceId: z.null(),
    kind: z.literal('none'),
    revision: z.number().int().nonnegative().safe(),
  }),
]);
export type ActiveGameScope = z.infer<typeof activeGameScopeSchema>;
export type GameViewScope = z.infer<typeof gameViewScopeSchema>;

export const challengeViewSchema = z.strictObject({
  challengeId: idSchema,
  exitId: idSchema,
  poseKind: poseKindSchema,
  startedAtTick: tickSchema,
  minSuccessTick: tickSchema,
  expiresAtTick: tickSchema,
});

const eventBase = {
  matchId: matchIdSchema,
  gameScope: activeGameScopeSchema,
  eventId: idSchema,
  tick: tickSchema,
  stateVersion: stateVersionSchema,
};
const event = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  z.strictObject({ ...eventBase, type: z.literal(type), payload });

export const privateEventSchema = z.discriminatedUnion('type', [
  event(
    'EXCHANGE_OFFER',
    z.strictObject({ exchangeId: idSchema, fromPlayerId: idSchema, expiresAtTick: tickSchema }),
  ),
  event('EXCHANGE_CANCELED', z.strictObject({ exchangeId: idSchema, reason: commandCodeSchema })),
  event(
    'EXCHANGE_COMPLETED',
    z.strictObject({ exchangeId: idSchema, mapVersion: z.number().int().nonnegative().safe() }),
  ),
  event(
    'HUNTER_MARKER',
    z.strictObject({
      markerId: idSchema,
      kind: z.enum(['exchange', 'sensor', 'trap']),
      point: tracePointSchema,
      occurredTick: tickSchema,
      showAtTick: tickSchema,
      expiresTick: tickSchema,
    }),
  ),
  event('EXIT_CHALLENGE', challengeViewSchema),
  event(
    'EXIT_CHALLENGE_ENDED',
    z.strictObject({
      challengeId: idSchema,
      result: z.enum(['canceled', 'failed', 'escaped']),
      reason: commandCodeSchema.nullable(),
    }),
  ),
]);
export type PrivateEvent = z.infer<typeof privateEventSchema>;
export type PrivateEventType = PrivateEvent['type'];

export const viewResyncSchema = z.strictObject({
  matchId: matchIdSchema,
  lastStateVersion: stateVersionSchema,
});
export type ViewResync = z.infer<typeof viewResyncSchema>;

const actionSchema = z.strictObject({
  kind: z.enum(['move', 'turn']),
  from: cellSchema.extend({ dir: dirSchema }),
  to: cellSchema.extend({ dir: dirSchema }),
  startTick: tickSchema,
  endTick: tickSchema,
});
const ownedEquipmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    equipmentId: idSchema,
    state: z.enum(['UNARMED', 'ARMED', 'SPENT']),
    armedTick: tickSchema,
    kind: z.literal('sensor'),
    cell: cellSchema,
    wall: wallFaceSchema,
  }),
  z.strictObject({
    equipmentId: idSchema,
    state: z.enum(['UNARMED', 'ARMED', 'SPENT']),
    armedTick: tickSchema,
    kind: z.literal('trap'),
    cell: cellSchema,
  }),
]);
export const activeSelfSchema = z.strictObject({
  playerId: idSchema,
  role: roleSchema,
  status: z.literal('ACTIVE'),
  cell: cellSchema,
  dir: dirSchema,
  action: actionSchema.nullable(),
  equipment: z.strictObject({
    sensor: z.number().int().nonnegative(),
    trap: z.number().int().nonnegative(),
  }),
  ownedEquipment: z.array(ownedEquipmentSchema),
  restraintUntilTick: tickSchema.nullable(),
  restraintImmuneUntilTick: tickSchema.nullable(),
  installation: z
    .strictObject({
      installationId: idSchema,
      kind: equipmentKindSchema,
      startTick: tickSchema,
      endTick: tickSchema,
      armedTick: tickSchema,
    })
    .nullable(),
  exchange: z
    .strictObject({
      exchangeId: idSchema,
      fromPlayerId: idSchema,
      toPlayerId: idSchema,
      direction: z.enum(['incoming', 'outgoing']),
      expiresAtTick: tickSchema,
    })
    .nullable(),
  challenge: challengeViewSchema.nullable(),
  loading: z
    .strictObject({
      loadId: idSchema,
      initialViewVersion: stateVersionSchema,
      mediaInstanceId: idSchema,
      receiverGeneration: z.number().int().nonnegative().safe(),
      assetVersion: z.string().min(1),
    })
    .nullable(),
});
export const endedSelfSchema = z.strictObject({
  playerId: idSchema,
  role: roleSchema,
  status: z.enum(['ESCAPED', 'CAPTURED']),
});
export const visibleEntitySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: idSchema,
    kind: z.literal('player'),
    cell: cellSchema,
    dir: dirSchema,
    action: actionSchema.nullable(),
    role: roleSchema.optional(),
  }),
  z.strictObject({
    id: idSchema,
    kind: z.literal('sensor'),
    cell: cellSchema,
    wall: wallFaceSchema,
    state: armStateSchema,
  }),
  z.strictObject({
    id: idSchema,
    kind: z.literal('trap'),
    cell: cellSchema,
    state: armStateSchema,
  }),
]);
export const knownTerrainSchema = z.discriminatedUnion('kind', [
  cellSchema.extend({ kind: z.literal('floor') }),
  wallFaceSchema.extend({ kind: z.literal('wall') }),
]);
export const knownExitSchema = z.strictObject({
  exitId: idSchema,
  ownerId: idSchema,
  wall: wallFaceSchema,
  approach: cellSchema,
});
export const privateViewSchema = z.strictObject({
  mapVersion: z.number().int().nonnegative().safe(),
  knownTerrain: z.array(knownTerrainSchema),
  knownActiveExits: z.array(knownExitSchema),
  matchId: matchIdSchema,
  gameScope: gameViewScopeSchema,
  stateVersion: stateVersionSchema,
  self: z.union([activeSelfSchema, endedSelfSchema]).nullable(),
  visibleCells: z.array(cellSchema),
  visibleWallFaces: z.array(wallFaceSchema),
  visibleEntities: z.array(visibleEntitySchema),
});
export type PrivateViewMessage = z.infer<typeof privateViewSchema>;
