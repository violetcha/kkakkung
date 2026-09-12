import { expect, it } from 'vitest';
import { MediaGenerationRegistry } from '../../src/media/MediaGenerationRegistry.js';
import { practiceFrame, prepareRequest } from './generation-fixtures.js';

it('closed matches reject delayed frames while unresolved revocations remain pinned', () => {
  const registry = new MediaGenerationRegistry('retention', true);
  expect(registry.observe(practiceFrame)).toBe(false);
  registry.openMatch('m');
  registry.observe(practiceFrame);
  const generation = registry.allocate(prepareRequest, 1_800_000_000_000);
  registry.endMatch('m');
  expect(registry.observe({ ...practiceFrame, frameRevision: 999 })).toBe(false);
  expect(registry.eligible(prepareRequest)).toBe(false);
  expect(registry.prune(() => true)).toEqual([]);
  generation.state = 'UNRESOLVED';
  expect(registry.prune(() => true)).toEqual([]);
  generation.state = 'REVOKED';
  expect(registry.prune(() => false)).toEqual([]);
  expect(registry.prune(() => true)).toEqual([generation]);
  expect(Object.values(registry.retained).every((count) => count === 0)).toBe(true);
});

it('10,000 completed invented matches leave no registry scopes behind', () => {
  const registry = new MediaGenerationRegistry('retention', true);
  for (let i = 0; i < 10_000; i++) {
    const matchId = `m-${i}`;
    registry.openMatch(matchId);
    registry.observe({ ...practiceFrame, matchId });
    const generation = registry.allocate({ ...prepareRequest, matchId }, 1_800_000_000_000);
    registry.abandonUnissued(generation);
    registry.endMatch(matchId);
    registry.prune((g) => registry.wasNeverIssued(g));
  }
  expect(Object.values(registry.retained).every((count) => count === 0)).toBe(true);
});
