// F-04 / DP-04: release image cleanup never removes a tag another build may still be scanning or
// deploying. kkakkung #140 lost kkakkung-web:c458e647 to kkakkung-mr #167's cleanup one second
// before its Trivy scan because the fresh tag sat on a cache-hit image that sorted as old.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEP,
  DEFAULT_MIN_AGE_MINUTES,
  parseArgs,
  parseDockerTime,
  planPrune,
} from '../../scripts/prune-release-images.mjs';

const HOUR = 60 * 60_000;
const now = Date.parse('2026-09-15T08:47:30Z');
const image = (tag: string, agoMs: number) => ({ tag, lastTagTimeMs: now - agoMs });

describe('prune-release-images', () => {
  it('reads docker LastTagTime with nanosecond precision and the zero time', () => {
    expect(parseDockerTime('"2026-09-15T08:47:21.93269248Z"')).toBe(
      Date.parse('2026-09-15T08:47:21.932Z'),
    );
    expect(parseDockerTime('2026-09-15T08:47:21Z')).toBe(Date.parse('2026-09-15T08:47:21Z'));
    expect(parseDockerTime('"0001-01-01T00:00:00Z"')).toBeLessThan(0);
    expect(() => parseDockerTime('yesterday')).toThrow(/unreadable/);
  });

  it('keeps the newest tags and removes only older ones whose last tagging is past the age guard', () => {
    const plan = planPrune({
      images: [
        image('old-a', 30 * HOUR),
        image('old-b', 20 * HOUR),
        image('n1', 10 * HOUR),
        image('n2', 9 * HOUR),
        image('n3', 8 * HOUR),
        image('n4', 7 * HOUR),
        image('n5', 6 * HOUR),
      ],
      keep: 5,
      minAgeMs: HOUR,
      protect: [],
      nowMs: now,
    });
    expect(plan.remove.map((i) => i.tag)).toEqual(['old-b', 'old-a']);
    expect(plan.kept.map((i) => `${i.tag}:${i.reason}`)).toEqual([
      'n5:recent',
      'n4:recent',
      'n3:recent',
      'n2:recent',
      'n1:recent',
    ]);
  });

  it('never removes a tag attached within the age guard even when it falls outside the keep window', () => {
    // The #140 case: six tags newer by last-tag time, and c458e647 tagged 9 seconds ago onto an
    // image created long before. Sorting by last tag time already ranks it newest; if it did not
    // (as with `docker images` ordering), the age guard still keeps it.
    const plan = planPrune({
      images: [
        ...Array.from({ length: 6 }, (_, i) => image(`mr-${i}`, (i + 1) * 5 * 60_000)),
        image('c458e647', 9_000),
      ],
      keep: 5,
      minAgeMs: HOUR,
      protect: [],
      nowMs: now,
    });
    expect(plan.remove).toEqual([]);
    expect(plan.kept.find((i) => i.tag === 'c458e647')?.reason).toBe('recent');
    expect(plan.kept.filter((i) => i.reason === 'young').map((i) => i.tag)).toEqual([
      'mr-4',
      'mr-5',
    ]);
  });

  it('keeps protected tags (current, last-good, running containers) regardless of age', () => {
    const plan = planPrune({
      images: [
        image('last-good', 3 * 24 * HOUR),
        image('current', 2 * 24 * HOUR),
        image('running', 24 * HOUR),
        image('stale', 12 * HOUR),
        image('a', 5 * HOUR),
        image('b', 4 * HOUR),
      ],
      keep: 2,
      minAgeMs: HOUR,
      protect: ['current', 'last-good', '', 'running'],
      nowMs: now,
    });
    expect(plan.remove.map((i) => i.tag)).toEqual(['stale']);
    expect(plan.kept.filter((i) => i.reason === 'protected').map((i) => i.tag)).toEqual([
      'running',
      'current',
      'last-good',
    ]);
  });

  it('ignores <none> tags and parses the Jenkins invocation', () => {
    expect(
      planPrune({
        images: [image('<none>', 99 * HOUR)],
        keep: 1,
        minAgeMs: 0,
        protect: [],
        nowMs: now,
      }).remove,
    ).toEqual([]);
    const options = parseArgs([
      '--keep',
      '5',
      '--min-age-minutes',
      '60',
      '--protect',
      'c458e647',
      '--protect',
      '',
      'kkakkung-game',
      'kkakkung-web',
    ]);
    expect(options).toEqual({
      keep: 5,
      minAgeMinutes: 60,
      protect: ['c458e647', ''],
      dryRun: false,
      repositories: ['kkakkung-game', 'kkakkung-web'],
    });
    expect(parseArgs(['kkakkung-game']).keep).toBe(DEFAULT_KEEP);
    expect(parseArgs(['kkakkung-game']).minAgeMinutes).toBe(DEFAULT_MIN_AGE_MINUTES);
    expect(() => parseArgs(['--keep', '0', 'x'])).toThrow(/--keep/);
    expect(() => parseArgs([])).toThrow(/repository/);
    expect(() => parseArgs(['--bogus', 'x'])).toThrow(/unknown option/);
  });
});
