import { expect, it } from 'vitest';
import { SPLIT_MEDIA_CHECKS, splitMediaVerdict } from './cloud/split-media-evidence.js';

const complete = () => Object.fromEntries(SPLIT_MEDIA_CHECKS.map((check) => [check, true]));

it('requires scoped sources, fresh face/audio, removal/reallow, receiver bindings and cleanup', () => {
  expect(splitMediaVerdict(complete())).toEqual({
    splitTransportVerified: true,
    productPublicReady: false,
    promotionAllowed: false,
  });
  for (const check of SPLIT_MEDIA_CHECKS) {
    for (const invalid of [false, null, undefined, 1, 'true']) {
      expect(splitMediaVerdict({ ...complete(), [check]: invalid }).splitTransportVerified).toBe(
        false,
      );
    }
    const missing = complete();
    delete missing[check];
    expect(splitMediaVerdict(missing).splitTransportVerified).toBe(false);
  }
});

it.each([null, undefined, false, true, {}, [], ['PASS'], 'PASS'])(
  'does not promote missing or malformed evidence %j',
  (value) => {
    expect(splitMediaVerdict(value)).toEqual({
      splitTransportVerified: false,
      productPublicReady: false,
      promotionAllowed: false,
    });
  },
);
