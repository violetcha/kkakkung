import { expect, it } from 'vitest';
import { preparationIssue } from '../../src/rooms/preparation-issue.js';

it.each([
  ['NOT_READY', 'SERVICE_NOT_READY'],
  ['LOADING_TIMEOUT', 'DEVICE_LOADING_TIMEOUT'],
  ['PRACTICE_MEDIA_NOT_READY', 'MEDIA_NOT_READY'],
  ['LAYOUT:INVALID:/private/map.json:coordinate=4,9', 'LAYOUT_UNAVAILABLE'],
  ['PRACTICE_LAYOUT:INVALID_PRACTICE_LAYOUT', 'LAYOUT_UNAVAILABLE'],
  ['unknown internal exception', 'PREPARATION_UNAVAILABLE'],
  [null, undefined],
] as const)('maps %s to safe round feedback', (diagnostic, expected) => {
  expect(preparationIssue(diagnostic)).toBe(expected);
});
