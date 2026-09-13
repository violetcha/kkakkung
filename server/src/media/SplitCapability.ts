import type { MinimumGrantProfile } from './CloudCapabilityProbe.js';

export type SplitGrantProfile = Readonly<{
  face: Omit<MinimumGrantProfile, 'canSubscribe' | 'canPublishSources'> &
    Readonly<{
      canSubscribe: false;
      canPublishSources: readonly ['camera'];
    }>;
  receiver: Omit<MinimumGrantProfile, 'canSubscribe' | 'canPublishSources'> &
    Readonly<{
      canSubscribe: true;
      canPublishSources: readonly ['microphone'];
    }>;
}>;

/** Required observations from the product integration probe, not a setting that enables public mode. */
export const SPLIT_AUTHORITY_CHECKS = [
  'productTransportUsed',
  'separatedSourcePermissions',
  'directAudioBlocked',
  'sameDestinationReallowedFresh',
  'receiverBindingsValidated',
  'neverJoinedTokenRejected',
  'lateForwardContained',
  'durableRecoveryVerified',
  'usageReservationVerified',
] as const;
export type SplitAuthorityProof = Readonly<
  Record<(typeof SPLIT_AUTHORITY_CHECKS)[number], boolean>
>;

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(input, key))
  )
    throw new Error('INVALID_SPLIT_CAPABILITY');
  return input as Record<string, unknown>;
}

export function parseSplitAuthorityProof(input: unknown): SplitAuthorityProof {
  const value = exact(input, SPLIT_AUTHORITY_CHECKS);
  if (Object.values(value).some((field) => typeof field !== 'boolean'))
    throw new Error('INVALID_SPLIT_AUTHORITY_PROOF');
  return Object.freeze({ ...value }) as SplitAuthorityProof;
}

export function parseSplitGrantProfile(input: unknown): SplitGrantProfile {
  const value = exact(input, ['face', 'receiver']);
  const parse = (raw: unknown, source: 'camera' | 'microphone', subscribe: boolean) => {
    const grant = exact(raw, [
      'roomJoin',
      'room',
      'canPublishData',
      'canSubscribe',
      'canPublishSources',
      'roomAdmin',
      'roomRecord',
      'roomCreate',
      'roomList',
    ]);
    if (
      grant.roomJoin !== true ||
      typeof grant.room !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(grant.room) ||
      grant.canSubscribe !== subscribe ||
      ['canPublishData', 'roomAdmin', 'roomRecord', 'roomCreate', 'roomList'].some(
        (key) => grant[key] !== false,
      ) ||
      !Array.isArray(grant.canPublishSources) ||
      grant.canPublishSources.length !== 1 ||
      grant.canPublishSources[0] !== source
    )
      throw new Error('INVALID_SPLIT_GRANT_PROFILE');
    return Object.freeze({
      roomJoin: true as const,
      room: grant.room,
      canPublishData: false as const,
      canSubscribe: subscribe,
      canPublishSources: Object.freeze([source]),
      roomAdmin: false as const,
      roomRecord: false as const,
      roomCreate: false as const,
      roomList: false as const,
    });
  };
  const face = parse(value.face, 'camera', false);
  const receiver = parse(value.receiver, 'microphone', true);
  if (face.room === receiver.room) throw new Error('INVALID_SPLIT_GRANT_ROOMS');
  return Object.freeze({ face, receiver }) as SplitGrantProfile;
}
