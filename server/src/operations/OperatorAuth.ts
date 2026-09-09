import { timingSafeEqual } from 'node:crypto';
import type { CreateOperatorAuth } from '../media/types.js';

// RFC 6750 b64token syntax; configuration and requests share the same strict grammar.
const bearerToken = /^[A-Za-z0-9._~+/-]+=*$/;

export const createOperatorAuth: CreateOperatorAuth = (token) => {
  const valid = typeof token === 'string' && token.trim() === token && bearerToken.test(token);
  const expected = valid ? Buffer.from(token, 'utf8') : Buffer.alloc(0);
  return (authorization) => {
    if (!valid || typeof authorization !== 'string' || !authorization.startsWith('Bearer '))
      return false;
    const supplied = authorization.slice(7);
    if (supplied.trim() !== supplied || !bearerToken.test(supplied)) return false;
    const actual = Buffer.from(supplied, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
};
