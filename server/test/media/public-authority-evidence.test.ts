import { expect, it } from 'vitest';
import {
  publicAuthorityVerdict,
  type PublicAuthorityEvidence,
} from './cloud/public-authority-evidence.js';

const evidence = (): PublicAuthorityEvidence => ({
  minimumGrant: { allowedFresh: false, directBlocked: true, removedBlocked: false },
  publisherPermissions: { allowedFresh: true, directBlocked: true, bypassObserved: true },
  forwarding: {
    api: 'accepted',
    allowedFresh: true,
    directBlocked: true,
    removedBlocked: true,
    forbiddenPositiveControl: true,
  },
  cleanupConfirmed: true,
});

it('requires real forward reception, exclusion, revocation and the forbidden receiver positive control', () => {
  expect(publicAuthorityVerdict(evidence())).toMatchObject({
    candidateAvailable: true,
    publisherControlBypassObserved: true,
    productPublicReady: false,
    promotionAllowed: false,
  });
  for (const field of [
    'allowedFresh',
    'directBlocked',
    'removedBlocked',
    'forbiddenPositiveControl',
  ] as const) {
    const partial = evidence();
    partial.forwarding[field] = false;
    expect(publicAuthorityVerdict(partial).candidateAvailable).toBe(false);
  }
});

it('a 200 API response, compliant publisher or unconfirmed cleanup never becomes a public transport proof', () => {
  const unconfirmed = evidence();
  unconfirmed.cleanupConfirmed = false;
  expect(publicAuthorityVerdict(unconfirmed).candidateAvailable).toBe(false);
  unconfirmed.cleanupConfirmed = true;
  unconfirmed.forwarding.api = 'unconfirmed';
  expect(publicAuthorityVerdict(unconfirmed).candidateAvailable).toBe(false);
  unconfirmed.minimumGrant = { allowedFresh: true, directBlocked: true, removedBlocked: true };
  expect(publicAuthorityVerdict(unconfirmed)).toMatchObject({
    serverControlledVerified: true,
    forwardedIsolationVerified: false,
    productPublicReady: false,
  });
});
