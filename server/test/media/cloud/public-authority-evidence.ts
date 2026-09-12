/** A transport spike is never a product capability or permission to open admission. */
export type PublicAuthorityEvidence = {
  minimumGrant: { allowedFresh: boolean; directBlocked: boolean; removedBlocked: boolean };
  publisherPermissions: { allowedFresh: boolean; directBlocked: boolean; bypassObserved: boolean };
  forwarding: {
    api: 'not-attempted' | 'accepted' | 'unsupported' | 'unconfirmed';
    allowedFresh: boolean;
    directBlocked: boolean;
    removedBlocked: boolean;
    forbiddenPositiveControl: boolean;
  };
  cleanupConfirmed: boolean;
};

export function publicAuthorityVerdict(evidence: PublicAuthorityEvidence) {
  const minimum = evidence.minimumGrant;
  const forwarding = evidence.forwarding;
  const serverControlled = minimum.allowedFresh && minimum.directBlocked && minimum.removedBlocked;
  const forwarded =
    forwarding.api === 'accepted' &&
    forwarding.allowedFresh &&
    forwarding.directBlocked &&
    forwarding.removedBlocked &&
    forwarding.forbiddenPositiveControl;
  return {
    serverControlledVerified: evidence.cleanupConfirmed && serverControlled,
    forwardedIsolationVerified: evidence.cleanupConfirmed && forwarded,
    publisherControlBypassObserved: evidence.publisherPermissions.bypassObserved,
    candidateAvailable: evidence.cleanupConfirmed && (serverControlled || forwarded),
    productPublicReady: false,
    promotionAllowed: false,
  } as const;
}
