/** Synthetic transport evidence is never permission to change the product audience. */
export const SPLIT_MEDIA_CHECKS = [
  'productTransportUsed',
  'separatedSourcePermissions',
  'faceOnlyReceived',
  'directAudioBlocked',
  'audioAllowedFresh',
  'audioRemovedBlocked',
  'sameDestinationReallowedFresh',
  'reverseAudioAllowedFresh',
  'receiverBindingsValidated',
  'cleanupConfirmed',
] as const;
export type SplitMediaEvidence = Record<(typeof SPLIT_MEDIA_CHECKS)[number], boolean>;

export function splitMediaVerdict(value: unknown) {
  const verified =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    SPLIT_MEDIA_CHECKS.every(
      (check) => Object.hasOwn(value, check) && (value as Record<string, unknown>)[check] === true,
    );
  return {
    splitTransportVerified: verified,
    productPublicReady: false,
    promotionAllowed: false,
  } as const;
}
