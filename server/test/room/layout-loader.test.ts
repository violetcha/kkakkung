import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LayoutLoader } from '../../src/game/LayoutLoader.js';
import { fakeClock, fakeMapPorts, fallbackFileFor, fakePracticePort } from './test-harness.js';

const players = [
  { playerId: 'session-r-b', role: 'runner' as const },
  { playerId: 'session-t-a', role: 'tagger' as const },
  { playerId: 'session-r-Z', role: 'runner' as const },
  { playerId: 'session-t-10', role: 'tagger' as const },
  { playerId: 'session-r-2', role: 'runner' as const },
  { playerId: 'session-t-Z', role: 'tagger' as const },
];

function files(masterBody = JSON.stringify({ regions: true })) {
  const master = Buffer.from(masterBody, 'utf8');
  const templateHash = createHash('sha256').update(master).digest('hex');
  const source = { templateId: 'tpl', templateVersion: 'v1', templateHash };
  const fallbacks = ['r0', 'r1', 'r2'].map((variantId) =>
    fallbackFileFor({ ...source, variantId }),
  );
  const store = new Map<string, Uint8Array>([
    ['master.json', master],
    ['fallback.json', Buffer.from(JSON.stringify(fallbacks), 'utf8')],
  ]);
  return {
    templateHash,
    store,
    readFile: async (path: string) => {
      const bytes = store.get(path);
      if (!bytes) throw new Error('ENOENT');
      return bytes;
    },
  };
}

describe('LayoutLoader', () => {
  it('hashes the master bytes, selects a variant by seed over sorted ids and binds the fallback', async () => {
    const f = files();
    const ports = fakeMapPorts({ failOnline: true });
    const clock = fakeClock(0);
    const yields: number[] = [];
    const loader = new LayoutLoader({
      ...ports,
      readFile: f.readFile,
      now: clock.now,
      yieldToEventLoop: async () => void yields.push(clock.now()),
    });
    const result = await loader.prepare({
      masterPath: 'master.json',
      fallbackPath: 'fallback.json',
      templateId: 'tpl',
      templateVersion: 'v1',
      players,
      seed: 4,
    });
    expect(result.status).toBe('selected');
    if (result.status !== 'selected') return;
    expect(result.source).toEqual({
      templateId: 'tpl',
      templateVersion: 'v1',
      templateHash: f.templateHash,
      variantId: 'r1',
    });
    expect(result.layout.source).toBe('fallback');
    // Slots were bound to the current players in default string order; no static slot remains.
    expect(result.layout.layout.players.map((p) => p.playerId).sort()).toEqual(
      players.map((p) => p.playerId).sort(),
    );
    const bound = result.layout.layout;
    const references = [
      ...bound.players.map((p) => p.playerId),
      ...bound.exits.map((e) => e.ownerId),
      ...bound.territories.map((t) => t.playerId),
    ];
    expect(references.every((id) => id.startsWith('session-'))).toBe(true);
    expect(ports.calls).toEqual([
      'validateTemplate',
      'createTemplateVariants',
      'certifyFallback',
      'selectWithFallback',
    ]);
    expect(yields.length).toBeGreaterThan(0);
  });

  it('prefers a successful online selection and returns unavailable when both paths fail', async () => {
    const f = files();
    const online = new LayoutLoader({
      ...fakeMapPorts(),
      readFile: f.readFile,
      now: fakeClock(0).now,
      yieldToEventLoop: async () => undefined,
    });
    const selected = await online.prepare({
      masterPath: 'master.json',
      fallbackPath: 'fallback.json',
      templateId: 'tpl',
      templateVersion: 'v1',
      players,
      seed: 0,
    });
    expect(selected.status === 'selected' && selected.layout.source).toBe('online');
    const neither = new LayoutLoader({
      ...fakeMapPorts({ failOnline: true, certifyFallback: false }),
      readFile: f.readFile,
      now: fakeClock(0).now,
      yieldToEventLoop: async () => undefined,
    });
    expect(
      await neither.prepare({
        masterPath: 'master.json',
        fallbackPath: 'fallback.json',
        templateId: 'tpl',
        templateVersion: 'v1',
        players,
        seed: 0,
      }),
    ).toEqual({
      status: 'unavailable',
      code: 'LAYOUT_UNAVAILABLE',
      diagnostic: 'fallback-uncertified',
    });
  });

  it('stops the selector on the monotonic budget and closes it with the certified fallback', async () => {
    const f = files();
    const ports = fakeMapPorts({ failOnline: true, batch: 8 });
    const clock = fakeClock(0);
    const loader = new LayoutLoader({
      ...ports,
      readFile: f.readFile,
      now: clock.now,
      yieldToEventLoop: async () => clock.advance(60),
    });
    const result = await loader.prepare({
      masterPath: 'master.json',
      fallbackPath: 'fallback.json',
      templateId: 'tpl',
      templateVersion: 'v1',
      players,
      seed: 0,
    });
    expect(result.status).toBe('selected');
    // 8 attempts per next; budget 100ms allows two batches before return(certified).
    expect(ports.calls.filter((c) => c === 'selectWithFallback')).toHaveLength(1);
    const invalidProgress = new LayoutLoader({
      ...fakeMapPorts({ failOnline: true, batch: 9 }),
      readFile: f.readFile,
      now: fakeClock(0).now,
      yieldToEventLoop: async () => undefined,
    });
    expect(
      await invalidProgress.prepare({
        masterPath: 'master.json',
        fallbackPath: 'fallback.json',
        templateId: 'tpl',
        templateVersion: 'v1',
        players,
        seed: 0,
      }),
    ).toMatchObject({ status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' });
    // S15P21C204-383. The batch bound is the tuning's attemptsPerBatch, not a fixed 8.
    const widerBatch = new LayoutLoader({
      ...fakeMapPorts({ failOnline: true, batch: 9 }),
      readFile: f.readFile,
      now: fakeClock(0).now,
      yieldToEventLoop: async () => undefined,
      maxBatch: 9,
    });
    expect(
      await widerBatch.prepare({
        masterPath: 'master.json',
        fallbackPath: 'fallback.json',
        templateId: 'tpl',
        templateVersion: 'v1',
        players,
        seed: 0,
      }),
    ).toMatchObject({ status: 'selected' });
  });

  // S15P21C204-383. A structurally valid template whose passages are broken never reaches a match.
  it('refuses a variant that fails the connectivity check', async () => {
    const f = files();
    const ports = fakeMapPorts({ failOnline: true });
    const loader = new LayoutLoader({
      ...ports,
      maps: {
        ...ports.maps,
        validateConnectivity: () => ({ ok: false, issues: [{ code: 'DISCONNECTED' }] }),
      },
      readFile: f.readFile,
      now: fakeClock(0).now,
      yieldToEventLoop: async () => undefined,
    });
    expect(
      await loader.prepare({
        masterPath: 'master.json',
        fallbackPath: 'fallback.json',
        templateId: 'tpl',
        templateVersion: 'v1',
        players,
        seed: 0,
      }),
    ).toMatchObject({
      status: 'unavailable',
      code: 'LOADER_FAILED',
      diagnostic: 'connectivity:DISCONNECTED',
    });
  });

  it('returns to preparation on missing files, invalid JSON, invalid templates and structurally broken fallbacks', async () => {
    const f = files();
    const base = { templateId: 'tpl', templateVersion: 'v1', players, seed: 0 };
    const loader = new LayoutLoader({
      ...fakeMapPorts(),
      readFile: f.readFile,
      now: fakeClock(0).now,
      yieldToEventLoop: async () => undefined,
    });
    expect(
      await loader.prepare({ ...base, masterPath: 'missing.json', fallbackPath: 'fallback.json' }),
    ).toMatchObject({ status: 'unavailable', code: 'LOADER_FAILED', diagnostic: 'master-read' });
    f.store.set('broken.json', Buffer.from('{not json', 'utf8'));
    expect(
      await loader.prepare({ ...base, masterPath: 'broken.json', fallbackPath: 'fallback.json' }),
    ).toMatchObject({ code: 'LOADER_FAILED', diagnostic: 'master-json' });
    f.store.set('invalid.json', Buffer.from(JSON.stringify({ nothing: true }), 'utf8'));
    expect(
      await loader.prepare({ ...base, masterPath: 'invalid.json', fallbackPath: 'fallback.json' }),
    ).toMatchObject({
      code: 'LOADER_FAILED',
      diagnostic: expect.stringContaining('template:INVALID_TEMPLATE'),
    });
    f.store.set(
      'wrong-hash-fallback.json',
      Buffer.from(
        JSON.stringify([
          fallbackFileFor({
            templateId: 'tpl',
            templateVersion: 'v1',
            templateHash: 'b'.repeat(64),
            variantId: 'r0',
          }),
        ]),
        'utf8',
      ),
    );
    expect(
      await loader.prepare({
        ...base,
        masterPath: 'master.json',
        fallbackPath: 'wrong-hash-fallback.json',
      }),
    ).toMatchObject({ code: 'LOADER_FAILED', diagnostic: 'fallback-structure' });
    expect(fakePracticePort).toBeDefined();
  });
});
