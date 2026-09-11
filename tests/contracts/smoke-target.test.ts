import { expect, it } from 'vitest';
import { validateSmokeTarget } from '../../scripts/lib/smoke-target.mjs';

it('permits only the fixed loopback endpoint with a dedicated 256-bit key', () => {
  expect(() =>
    validateSmokeTarget('http://127.0.0.1:18081', 'https://example.test', 'a'.repeat(64)),
  ).not.toThrow();
});
it.each([
  'http://0.0.0.0:18081',
  'http://localhost:18081',
  'https://example.test',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:18081/path',
  'http://127.0.0.1:18081@evil.test',
])('rejects credential forwarding to %s', (url) => {
  expect(() => validateSmokeTarget(url, 'https://example.test', 'a'.repeat(64))).toThrow(
    'DP06_INTERNAL_TARGET_OR_CREDENTIAL_INVALID',
  );
});
it.each(['', 'cookie-value', 'a'.repeat(63), 'a'.repeat(64) + '\r\nInjected: yes'])(
  'rejects malformed keys without echoing them',
  (key) => {
    expect(() =>
      validateSmokeTarget('http://127.0.0.1:18081', 'https://example.test', key),
    ).toThrow('DP06_INTERNAL_TARGET_OR_CREDENTIAL_INVALID');
  },
);
it.each(['http://example.test', 'https://user:password@example.test', 'https://example.test/path'])(
  'requires a public HTTPS origin: %s',
  (url) => {
    expect(() => validateSmokeTarget('http://127.0.0.1:18081', url, 'a'.repeat(64))).toThrow();
  },
);
