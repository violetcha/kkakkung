import { expect, it } from 'vitest';
import {
  UNJOINED_REVOCATION_CHECKS,
  unjoinedRevocationVerdict,
} from './cloud/unjoined-revocation-evidence.js';

const observations = () => Object.fromEntries(UNJOINED_REVOCATION_CHECKS.map((key) => [key, true]));

it('does not promote the product even when every scoped observation passes', () => {
  expect(unjoinedRevocationVerdict(observations())).toEqual({
    emptyRoomRevocationVerified: true,
    productPublicReady: false,
    promotionAllowed: false,
  });
});

it.each(UNJOINED_REVOCATION_CHECKS)('requires the actual %s observation', (key) => {
  for (const value of [false, undefined, 'true'])
    expect(unjoinedRevocationVerdict({ ...observations(), [key]: value })).toEqual({
      emptyRoomRevocationVerified: false,
      productPublicReady: false,
      promotionAllowed: false,
    });
});

it('rejects absent and inherited observations', () => {
  for (const value of [null, {}, [], true, Object.create(observations())])
    expect(unjoinedRevocationVerdict(value).emptyRoomRevocationVerified).toBe(false);
});
