/** Actual Cloud observations only. This narrow probe cannot promote the split capability. */
export const UNJOINED_REVOCATION_CHECKS = [
  'productOwnershipUsed',
  'roomsInitiallyAbsent',
  'missingRemoveAcknowledged',
  'missingParticipantsAbsent',
  'productAbsenceConfirmed',
  'neverJoinedTokensRejected',
  'freshControlsConnected',
  'creationPreservedCutoffs',
  'recreationPreservedCutoffs',
  'cleanupConfirmed',
] as const;
export type UnjoinedRevocationEvidence = Record<
  (typeof UNJOINED_REVOCATION_CHECKS)[number],
  boolean
>;

export function unjoinedRevocationVerdict(value: unknown) {
  const verified =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    UNJOINED_REVOCATION_CHECKS.every(
      (key) => Object.hasOwn(value, key) && (value as Record<string, unknown>)[key] === true,
    );
  return {
    emptyRoomRevocationVerified: verified,
    productPublicReady: false,
    promotionAllowed: false,
  };
}
