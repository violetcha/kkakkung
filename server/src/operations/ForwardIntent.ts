import { safeIdentifier, strictObject } from './CheckpointStore.js';
import type { JournalRecord } from './OperationJournal.js';

/** Write-ahead uncertainty, not evidence that the provider applied a forward. No TTL can settle it. */
export type ForwardIntent = Readonly<{
  operationId: string;
  sourceRoomName: string;
  identity: string;
  destinationRoomName: string;
}>;

/** Only the process that observed the dispatched call's known outcome receives this handle. */
export type ForwardCompletion = Readonly<{ completeKnown: () => Promise<void> }>;

export function validateForwardIntents(
  value: unknown,
  owner: JournalRecord,
): readonly ForwardIntent[] {
  if (!owner.splitOwnership || !Array.isArray(value) || value.length > 10)
    throw new Error('INVALID_FORWARD_INTENTS');
  const result = value.map((raw) => {
    const intent = strictObject(raw, [
      'operationId',
      'sourceRoomName',
      'identity',
      'destinationRoomName',
    ]);
    if (!Object.values(intent).every(safeIdentifier)) throw new Error('INVALID_FORWARD_INTENT');
    const voice = intent.sourceRoomName === owner.roomName && intent.identity === owner.identity;
    const face =
      intent.sourceRoomName === owner.splitOwnership!.faceRoomName &&
      intent.identity === owner.splitOwnership!.faceIdentity;
    if (
      (!voice && !face) ||
      !owner.splitOwnership!.receiverRoomNames.includes(intent.destinationRoomName as string)
    )
      throw new Error('FORWARD_INTENT_OUTSIDE_OWNERSHIP');
    return { ...intent } as ForwardIntent;
  });
  if (
    new Set(result.map((intent) => intent.operationId)).size !== result.length ||
    new Set(
      result.map((intent) => JSON.stringify([intent.sourceRoomName, intent.destinationRoomName])),
    ).size !== result.length ||
    (['REVOKED', 'ABORTED'].includes(owner.state) && result.length > 0)
  )
    throw new Error('UNCONFIRMED_FORWARD_INTENTS');
  return result;
}
