import { describe, expect, it } from 'vitest';
import { createOperatorAuth } from '../../src/operations/OperatorAuth.js';

describe('E-14 single operator Bearer authentication factory', () => {
  it('accepts an exact configured token and rejects same-length substitutions', () => {
    const authenticate = createOperatorAuth('operator-fixture._~+/-==');
    expect(authenticate('Bearer operator-fixture._~+/-==')).toBe(true);
    expect(authenticate('Bearer operator-Fixture._~+/-==')).toBe(false);
    expect(authenticate('Bearer Operator-fixture._~+/-==')).toBe(false);
  });

  it.each([
    undefined,
    '',
    'fixture',
    'Basic fixture',
    'bearer fixture',
    'Bearer',
    'Bearer ',
    'Bearer  fixture',
    'Bearer\tfixture',
    ' Bearer fixture',
    'Bearer fixture ',
    'Bearer fixture\n',
    'Bearer fixture\r\n',
    'Bearer fixture, Bearer fixture',
    'Bearer fixtur',
    'Bearer fixtures',
    'Bearer fIxture',
    'Bearer fixturé',
    'Bearer fix\u0000ture',
  ])('rejects malformed, missing, or nonmatching authorization %#', (header) => {
    expect(createOperatorAuth('fixture')(header)).toBe(false);
  });

  it.each([
    '',
    ' ',
    '\t',
    ' fixture',
    'fixture ',
    'fixture\n',
    'fixt ure',
    'fixture\u0000',
    'fixture:secret',
    'fixture=middle',
    'fixture,other',
    'fixtureé',
    '=',
  ])('fails closed for invalid configured token %#', (token) => {
    const authenticate = createOperatorAuth(token);
    expect(authenticate(`Bearer ${token}`)).toBe(false);
    expect(authenticate('Bearer fixture')).toBe(false);
  });

  it('tolerates untyped configuration and header values without authenticating', () => {
    expect(createOperatorAuth(null as unknown as string)('Bearer null')).toBe(false);
    expect(createOperatorAuth('fixture')({} as unknown as string)).toBe(false);
  });
});
