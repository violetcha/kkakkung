import { describe, expect, it } from 'vitest';
import { evaluateMetadataObservation } from '../cloud/MetadataObservation.js';

describe('QA08 rejects empty or incomplete Cloud observations', () => {
  it('rejects an empty namespace even when the metadata findings list is empty', () => {
    expect(evaluateMetadataObservation(0, 0, true)).toEqual({
      status: 'FAIL',
      code: 'QA08_NO_NAMESPACE_ROOMS',
      rooms: 0,
      participants: 0,
    });
  });
  it.each([1, 2])('rejects %i observed rooms with no participants', (rooms) => {
    expect(evaluateMetadataObservation(rooms, 0, true)).toMatchObject({
      status: 'FAIL',
      code: 'QA08_NO_PARTICIPANTS',
      rooms,
      participants: 0,
    });
  });
  it('requires observation completion even if an earlier query already saw a participant', () => {
    expect(evaluateMetadataObservation(2, 1, false)).toMatchObject({
      status: 'FAIL',
      code: 'QA08_NOT_COMPLETED',
      rooms: 2,
      participants: 1,
    });
  });
  it('accepts the minimum real observation without inventing a new preflight population target', () => {
    expect(evaluateMetadataObservation(1, 1, true)).toEqual({
      status: 'PASS',
      code: 'QA08_OBSERVED',
      rooms: 1,
      participants: 1,
    });
    expect(evaluateMetadataObservation(2, 1, true).status).toBe('PASS');
  });
  it.each([
    [NaN, 1],
    [1, Infinity],
    [-1, 1],
    [1, 0.5],
  ])('fails closed on invalid count inputs', (rooms, participants) => {
    expect(evaluateMetadataObservation(rooms!, participants!, true)).toMatchObject({
      status: 'FAIL',
      code: 'QA08_INVALID_COUNTS',
    });
  });
  it('serializes only explicit counts, status and fixed code', () => {
    expect(Object.keys(evaluateMetadataObservation(1, 1, true)).sort()).toEqual([
      'code',
      'participants',
      'rooms',
      'status',
    ]);
  });
});
