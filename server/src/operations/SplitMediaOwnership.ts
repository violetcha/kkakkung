import { isDeepStrictEqual } from 'node:util';
import { ownsMediaRoom } from '../media/MediaRoomOwnership.js';
import { safeIdentifier, strictObject } from './CheckpointStore.js';

/** Fixed before either token is signed. Includes every possible forwarding destination,
 * even when no participant has joined or a forwarding request timed out before its ACK.
 * The root record owns the MIC/private-receiver origin; this object owns its CAMERA origin.
 */
export type SplitMediaOwnership = Readonly<{
  faceRoomName: string;
  faceIdentity: string;
  receiverRoomNames: readonly string[];
}>;
type Owner = Readonly<{
  roomName: string;
  identity: string;
  splitOwnership?: SplitMediaOwnership;
}>;

export function validateSplitMediaOwnership(
  value: unknown,
  scope: Readonly<{ namespace: string; serverEpoch: string; roomName: string; identity: string }>,
): SplitMediaOwnership {
  const data = strictObject(value, ['faceRoomName', 'faceIdentity', 'receiverRoomNames']);
  if (
    typeof data.faceRoomName !== 'string' ||
    !safeIdentifier(data.faceIdentity) ||
    data.faceIdentity === scope.identity ||
    !Array.isArray(data.receiverRoomNames) ||
    data.receiverRoomNames.length > 5
  )
    throw new Error('INVALID_SPLIT_MEDIA_OWNERSHIP');
  const names = [scope.roomName, data.faceRoomName, ...data.receiverRoomNames];
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        typeof name !== 'string' ||
        !ownsMediaRoom(scope.namespace, name) ||
        name.split('--')[1] !== scope.serverEpoch,
    )
  )
    throw new Error('INVALID_SPLIT_MEDIA_OWNERSHIP');
  return {
    faceRoomName: data.faceRoomName,
    faceIdentity: data.faceIdentity,
    receiverRoomNames: [...data.receiverRoomNames] as string[],
  };
}

export function sameMediaOwnership(left: Owner, right: Owner): boolean {
  return isDeepStrictEqual(left.splitOwnership ?? null, right.splitOwnership ?? null);
}

/** The two token origins always precede clones. No room inventory can replace this list. */
export function ownedMediaTargets(owner: Owner): readonly Readonly<{
  roomName: string;
  identity: string;
}>[] {
  const root = { roomName: owner.roomName, identity: owner.identity };
  const split = owner.splitOwnership;
  if (!split) return [root];
  return [
    root,
    { roomName: split.faceRoomName, identity: split.faceIdentity },
    ...split.receiverRoomNames.flatMap((roomName) => [
      { roomName, identity: split.faceIdentity },
      { roomName, identity: owner.identity },
    ]),
  ];
}

export function ownedMediaRooms(owner: Owner): readonly string[] {
  return [...new Set(ownedMediaTargets(owner).map((target) => target.roomName))];
}
