// F-16 / DP-06 release barrier: every branch of scripts/lib/release-sequence.mjs against scripted
// adapters (no Docker, no network, no clock), the manifest builder, and the wiring in the
// Jenkinsfile and infra/deploy.sh (no direct compose up or build outside the runner).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DEADLINES,
  runRelease,
  validateManifest,
  type ReleaseAdapters,
  type ReleaseInput,
  type ReleaseManifest,
} from '../../scripts/lib/release-sequence.mjs';
import { buildManifest, readPrevious } from '../../scripts/verify-release.mjs';
import { createHealthHandlers } from '../../server/src/health/HealthHandlers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHA = 'a'.repeat(40);
const TAG = SHA.slice(0, 8);
const PREV_TAG = 'b'.repeat(8);
const digest = (c: string) => `sha256:${c.repeat(64)}`;

/** Use E's actual public projection; operations-only fields must not leak into health. */
function readyResponse(state: 'READY' | 'RECOVERING') {
  let response!: { status: number; json: unknown };
  const handlers = createHealthHandlers({
    isInitialized: () => true,
    getReadiness: () => ({
      state,
      reasonCodes: state === 'READY' ? [] : ['RECOVERY_PENDING'],
      historyComplete: state === 'READY',
      unresolvedCount: 0,
    }),
  });
  handlers.ready(
    {} as never,
    {
      setHeader: () => undefined,
      status: (status: number) => ({
        json: (json: unknown) => {
          response = { status, json };
        },
      }),
    } as never,
    () => undefined,
  );
  return response;
}

const manifest = (over: Partial<ReleaseManifest> = {}): ReleaseManifest => ({
  releaseSha: SHA,
  tag: TAG,
  verifiedSha: SHA,
  profile: 'product',
  images: {
    game: { ref: `kkakkung-game:${TAG}`, digest: digest('1'), revision: SHA },
    web: { ref: `kkakkung-web:${TAG}`, digest: digest('2'), revision: SHA },
  },
  previous: {
    tag: PREV_TAG,
    images: { game: { digest: digest('3') }, web: { digest: digest('4') } },
  },
  officialBudgetMaxAgeMs: 3_600_000,
  ...over,
});

type Snapshot = { status: 'pending' | 'succeeded' | 'failed'; code?: string | null };
type World = {
  ops: 'available' | 'unavailable' | 'rejected';
  gateStatus: number;
  liveStatus: number;
  anonymousOpsStatus: number;
  /** Per action, the snapshot sequence returned by successive polls (last one repeats). */
  drainSnapshots: Snapshot[];
  resumeSnapshots: Snapshot[];
  statusAfterDrain: Record<string, unknown>;
  statusAfterResume: Record<string, unknown>;
  readySequence: { status: number; json?: unknown }[];
  /** Per-tag overrides so a rollback target can behave differently from the new image. */
  readyByTag?: Record<string, { status: number; json?: unknown }[]>;
  statusAfterResumeByTag?: Record<string, Record<string, unknown>>;
  running: Record<string, Record<'game' | 'web', string | null>>;
  images: Record<string, { id: string; revision: string | null } | null>;
  composeCodes: Record<string, number>;
  smokeCodes: Record<string, number>;
};

function world(over: Partial<World> = {}): World {
  return {
    ops: 'available',
    gateStatus: 302,
    liveStatus: 200,
    anonymousOpsStatus: 401,
    drainSnapshots: [{ status: 'succeeded', code: null }],
    resumeSnapshots: [{ status: 'succeeded', code: null }],
    statusAfterDrain: {
      admission: 'DRAINING',
      readiness: 'READY',
      unresolvedCount: 0,
      remainingMinutes: 100,
      remainingBytes: 1e9,
      checkedAtEpochMs: 1_000_000,
    },
    statusAfterResume: {
      admission: 'OPEN',
      readiness: 'READY',
      unresolvedCount: 0,
      remainingMinutes: 100,
      remainingBytes: 1e9,
      checkedAtEpochMs: 1_000_000,
    },
    readySequence: [readyResponse('READY')],
    running: {
      [TAG]: { game: digest('1'), web: digest('2') },
      [PREV_TAG]: { game: digest('3'), web: digest('4') },
    },
    images: {
      [`kkakkung-game:${TAG}`]: { id: digest('1'), revision: SHA },
      [`kkakkung-web:${TAG}`]: { id: digest('2'), revision: SHA },
      [`kkakkung-game:${PREV_TAG}`]: { id: digest('3'), revision: 'b'.repeat(40) },
      [`kkakkung-web:${PREV_TAG}`]: { id: digest('4'), revision: 'b'.repeat(40) },
    },
    composeCodes: {},
    smokeCodes: {},
    ...over,
  };
}

/** Scripted adapters plus a recorder of every side effect the barrier performed. */
function harness(w: World) {
  let clock = 1_000_000;
  const calls = {
    compose: [] as string[],
    posts: [] as { requestId: string; action: string }[],
    smoke: [] as string[],
    state: {} as Record<string, string>,
    polls: [] as string[],
  };
  const snapshots = new Map<string, { action: string; queue: Snapshot[]; operationId: string }>();
  let currentTag: string | null = PREV_TAG;
  let resumed = false;
  let readyIndex = 0;
  const adapters: ReleaseAdapters = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    async http(method, url, options = {}) {
      const u = new URL(url);
      const local = u.origin === 'http://127.0.0.1:8080';
      if (!local) {
        if (u.pathname === '/api/config') return { status: w.gateStatus, json: null };
        if (u.pathname === '/health/live') return { status: w.liveStatus, json: null };
        return { status: 404, json: null };
      }
      if (u.pathname === '/health/ready') {
        const seq = w.readyByTag?.[currentTag ?? ''] ?? w.readySequence;
        const entry = seq[Math.min(readyIndex, seq.length - 1)]!;
        readyIndex++;
        return { status: entry.status, json: entry.json ?? null };
      }
      if (u.pathname.startsWith('/api/operations')) {
        if (!options.bearer) return { status: w.anonymousOpsStatus, json: null };
        if (w.ops === 'unavailable')
          return { status: 503, json: { error: 'OPERATIONS_UNAVAILABLE' } };
        if (w.ops === 'rejected') return { status: 401, json: null };
        if (u.pathname === '/api/operations/status')
          return {
            status: 200,
            json: resumed
              ? (w.statusAfterResumeByTag?.[currentTag ?? ''] ?? w.statusAfterResume)
              : w.statusAfterDrain,
          };
        if (method === 'POST') {
          const body = options.body as { requestId: string; action: string };
          calls.posts.push({ requestId: body.requestId, action: body.action });
          const existing = snapshots.get(body.requestId);
          if (existing && existing.action !== body.action)
            return { status: 409, json: { error: 'REQUEST_ID_CONFLICT' } };
          const queue = body.action === 'drain' ? [...w.drainSnapshots] : [...w.resumeSnapshots];
          const entry = existing ?? {
            action: body.action,
            queue,
            operationId: `op-${snapshots.size + 1}`,
          };
          snapshots.set(body.requestId, entry);
          return {
            status: 202,
            json: {
              requestId: body.requestId,
              operationId: entry.operationId,
              action: body.action,
              status: 'pending',
              code: null,
              updatedAtEpochMs: clock,
            },
          };
        }
        const requestId = u.pathname.split('/').pop()!;
        calls.polls.push(requestId);
        const entry = snapshots.get(requestId);
        if (!entry) return { status: 404, json: { error: 'NOT_FOUND' } };
        const next = entry.queue.length > 1 ? entry.queue.shift()! : entry.queue[0]!;
        if (next.status === 'succeeded') resumed = entry.action === 'resume';
        return {
          status: 200,
          json: {
            requestId,
            operationId: entry.operationId,
            action: entry.action,
            status: next.status,
            code: next.code ?? null,
            updatedAtEpochMs: clock,
          },
        };
      }
      return { status: 404, json: null };
    },
    async inspectImage(ref) {
      return w.images[ref] ?? null;
    },
    async runningImage(service) {
      return currentTag ? (w.running[currentTag]?.[service] ?? null) : null;
    },
    async compose(tag) {
      calls.compose.push(tag);
      const code = w.composeCodes[tag] ?? 0;
      if (code === 0) {
        currentTag = tag;
        readyIndex = 0;
        resumed = false;
      }
      return { code };
    },
    async runSmoke(mode) {
      calls.smoke.push(mode);
      return { code: w.smokeCodes[currentTag ?? ''] ?? 0 };
    },
    writeState(name, text) {
      calls.state[name] = text;
    },
  };
  const input = (over: Partial<ReleaseInput> = {}): ReleaseInput => ({
    manifest: manifest(),
    baseUrl: 'https://j15c204.p.ssafy.io',
    localUrl: 'http://127.0.0.1:8080',
    opsTokenPresent: true,
    smokePreflightPresent: true,
    nowEpochMs: () => clock,
    deadlines: { drainMs: 10_000, readyMs: 10_000, recoverMs: 10_000, resumeMs: 10_000 },
    ...over,
  });
  return {
    adapters,
    calls,
    input,
    get clock() {
      return clock;
    },
  };
}

describe('manifest validation', () => {
  it('accepts a complete manifest and reports every defect of a broken one', () => {
    expect(validateManifest(manifest())).toEqual([]);
    const issues = validateManifest(
      manifest({ verifiedSha: 'c'.repeat(40), images: { game: manifest().images.game } as never }),
    );
    expect(issues.join('\n')).toMatch(/verifiedSha differs/);
    expect(issues.join('\n')).toMatch(/images\.web missing/);
    expect(validateManifest(manifest({ tag: 'ffffffff' }))).toContain(
      'tag is not a prefix of releaseSha',
    );
    expect(validateManifest(null)).toEqual(['manifest is not an object']);
  });

  it('buildManifest reads both images and the last-good record, and refuses a missing image', () => {
    const inspect = (ref: string) =>
      ref.endsWith(TAG)
        ? { id: ref.startsWith('kkakkung-game') ? digest('1') : digest('2'), revision: SHA }
        : null;
    const readState = (name: string) =>
      name === 'last-good-tag' ? `${PREV_TAG}\n` : `game ${digest('3')}\nweb  ${digest('4')}\n`;
    const built = buildManifest(
      { sha: SHA, tag: TAG, verifiedSha: SHA, profile: 'skeleton', nowEpochMs: 0 },
      inspect,
      readState,
    );
    expect(built.manifest?.previous).toEqual({
      tag: PREV_TAG,
      images: { game: { digest: digest('3') }, web: { digest: digest('4') } },
    });
    expect(built.manifest?.images.web.digest).toBe(digest('2'));
    expect(
      buildManifest(
        { sha: SHA, tag: TAG, verifiedSha: SHA, profile: 'skeleton' },
        () => null,
        readState,
      ),
    ).toMatchObject({ error: 'IMAGE_MISSING' });
    // A different verified commit is refused before anything is written.
    expect(
      buildManifest(
        { sha: SHA, tag: TAG, verifiedSha: 'c'.repeat(40), profile: 'skeleton' },
        inspect,
        readState,
      ),
    ).toMatchObject({ error: 'MANIFEST_INVALID' });
    // A half-written last-good record yields no previous rather than a guess.
    expect(
      readPrevious((n) => (n === 'last-good-tag' ? PREV_TAG : `game ${digest('3')}`)),
    ).toBeNull();
  });
});

describe('barrier before the swap', () => {
  it.each([null, undefined, 0, Number.NaN])(
    'rejects a product manifest without a valid official max age before any side effect: %s',
    async (officialBudgetMaxAgeMs) => {
      const h = harness(world());
      const out = await runRelease(
        h.input({ manifest: manifest({ officialBudgetMaxAgeMs }) }),
        h.adapters,
      );
      expect(out).toMatchObject({ result: 'BLOCKED', reason: 'MANIFEST_INVALID' });
      expect(h.calls.posts).toEqual([]);
      expect(h.calls.compose).toEqual([]);
    },
  );

  it('a release whose verified SHA differs is BLOCKED: no drain, no compose', async () => {
    const h = harness(world());
    const out = await runRelease(
      h.input({ manifest: manifest({ verifiedSha: 'c'.repeat(40) }) }),
      h.adapters,
    );
    expect(out).toMatchObject({
      result: 'BLOCKED',
      phase: 'BLOCKED',
      reason: 'MANIFEST_INVALID',
      exitCode: 3,
    });
    expect(h.calls.compose).toEqual([]);
    expect(h.calls.posts).toEqual([]);
  });

  it('a missing web image or a wrong revision label is BLOCKED', async () => {
    const missing = harness(
      world({ images: { ...world().images, [`kkakkung-web:${TAG}`]: null } }),
    );
    expect(await runRelease(missing.input(), missing.adapters)).toMatchObject({
      result: 'BLOCKED',
      reason: 'IMAGE_MISSING',
    });
    const relabeled = harness(
      world({
        images: {
          ...world().images,
          [`kkakkung-game:${TAG}`]: { id: digest('1'), revision: 'c'.repeat(40) },
        },
      }),
    );
    expect(await runRelease(relabeled.input(), relabeled.adapters)).toMatchObject({
      result: 'BLOCKED',
      reason: 'IMAGE_LABEL_MISMATCH',
    });
    expect(missing.calls.compose).toEqual([]);
    expect(relabeled.calls.compose).toEqual([]);
  });

  it('missing isolation evidence (public API answers 200) is BLOCKED before any drain', async () => {
    const h = harness(world({ gateStatus: 200 }));
    const out = await runRelease(h.input(), h.adapters);
    expect(out).toMatchObject({ result: 'BLOCKED', reason: 'ISOLATION_UNVERIFIED' });
    expect(h.calls.posts).toEqual([]);
    const open = harness(world({ anonymousOpsStatus: 200 }));
    expect(await runRelease(open.input(), open.adapters)).toMatchObject({
      result: 'BLOCKED',
      reason: 'OPERATIONS_UNAUTHENTICATED',
    });
  });

  it('product profile without operations, token or preflight is BLOCKED', async () => {
    const noOps = harness(world({ ops: 'unavailable' }));
    expect(await runRelease(noOps.input(), noOps.adapters)).toMatchObject({
      result: 'BLOCKED',
      reason: 'OPERATIONS_UNAVAILABLE',
    });
    const noToken = harness(world());
    expect(
      await runRelease(noToken.input({ opsTokenPresent: false }), noToken.adapters),
    ).toMatchObject({ result: 'BLOCKED', reason: 'OPS_TOKEN_MISSING' });
    const noPreflight = harness(world());
    expect(
      await runRelease(noPreflight.input({ smokePreflightPresent: false }), noPreflight.adapters),
    ).toMatchObject({ result: 'BLOCKED', reason: 'SMOKE_PREFLIGHT_MISSING' });
    const rejected = harness(world({ ops: 'rejected' }));
    expect(await runRelease(rejected.input(), rejected.adapters)).toMatchObject({
      result: 'BLOCKED',
      reason: 'OPS_TOKEN_REJECTED',
    });
  });

  it('drain 202 + pending until the deadline swaps nothing and exits nonzero', async () => {
    const h = harness(world({ drainSnapshots: [{ status: 'pending' }] }));
    const out = await runRelease(h.input(), h.adapters);
    expect(out).toMatchObject({
      result: 'FAILED',
      phase: 'DRAINING',
      reason: 'DRAIN_TIMEOUT',
      exitCode: 1,
    });
    expect(h.calls.compose).toEqual([]);
    // One drain POST only; every poll used that same requestId (no duplicate drain).
    expect(h.calls.posts).toHaveLength(1);
    expect(new Set(h.calls.polls)).toEqual(new Set([h.calls.posts[0]!.requestId]));
  });

  it('drain failed, or succeeded with an unresolved retirement, keeps the old image', async () => {
    const failed = harness(
      world({
        drainSnapshots: [{ status: 'pending' }, { status: 'failed', code: 'OPERATION_TIMEOUT' }],
      }),
    );
    expect(await runRelease(failed.input(), failed.adapters)).toMatchObject({
      result: 'FAILED',
      reason: 'DRAIN_FAILED',
      detail: 'code=OPERATION_TIMEOUT',
    });
    const unresolved = harness(
      world({ statusAfterDrain: { ...world().statusAfterDrain, unresolvedCount: 1 } }),
    );
    expect(await runRelease(unresolved.input(), unresolved.adapters)).toMatchObject({
      result: 'FAILED',
      reason: 'DRAIN_UNRESOLVED',
    });
    expect(failed.calls.compose).toEqual([]);
    expect(unresolved.calls.compose).toEqual([]);
  });
});

describe('release, recovery, resume, smoke, publication', () => {
  it('the full product barrier ends READY with last-good written and distinct drain/resume ids', async () => {
    const h = harness(
      world({
        readySequence: [readyResponse('RECOVERING'), readyResponse('READY')],
      }),
    );
    const out = await runRelease(h.input(), h.adapters);
    expect(out).toMatchObject({
      result: 'READY',
      phase: 'READY',
      exitCode: 0,
      lastGoodWritten: true,
    });
    expect(h.calls.compose).toEqual([TAG]);
    expect(h.calls.smoke).toEqual(['cloud']);
    expect(h.calls.posts.map((p) => p.action)).toEqual(['drain', 'resume']);
    expect(h.calls.posts[0]!.requestId).not.toBe(h.calls.posts[1]!.requestId);
    expect(h.calls.state['last-good-tag']).toBe(`${TAG}\n`);
    expect(h.calls.state['last-good-digest']).toContain(`game ${digest('1')}`);
    expect(out.steps.map((s) => s.phase)).toContain('RECOVERING');
    // ready 200 alone never counted as READY: the readiness/OPEN checks are separate steps.
    expect(out.steps.filter((s) => s.status === 'PASS').map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'RELEASE ready',
        'RELEASE readiness',
        'RELEASE resume state',
        'publication re-check',
      ]),
    );
  });

  it('uses the recovery deadline for E public state RECOVERING without requiring public admission', async () => {
    const h = harness(
      world({
        readySequence: [
          readyResponse('RECOVERING'),
          readyResponse('RECOVERING'),
          readyResponse('RECOVERING'),
          readyResponse('READY'),
        ],
      }),
    );
    const out = await runRelease(
      h.input({ deadlines: { readyMs: 1000, recoverMs: 10_000 } }),
      h.adapters,
    );
    expect(out.result).toBe('READY');
    expect(h.clock).toBe(1_009_000);
    expect(readyResponse('READY').json).toEqual({ state: 'READY', reasonCodes: [] });
  });

  it('resume succeeded but admission LOCKED is a completion mismatch → new drain, rollback to the recorded digest', async () => {
    const h = harness(
      world({
        statusAfterResumeByTag: { [TAG]: { ...world().statusAfterResume, admission: 'LOCKED' } },
      }),
    );
    const out = await runRelease(h.input(), h.adapters);
    expect(out).toMatchObject({ result: 'ROLLED_BACK', exitCode: 1, lastGoodWritten: false });
    expect(out.reason).toMatch(/RELEASE_RESUME_MISMATCH/);
    expect(h.calls.compose).toEqual([TAG, PREV_TAG]);
    const actions = h.calls.posts.map((p) => p.action);
    expect(actions).toEqual(['drain', 'resume', 'drain', 'resume']);
    expect(new Set(h.calls.posts.map((p) => p.requestId)).size).toBe(4);
    expect(h.calls.state['last-good-tag']).toBeUndefined();
  });

  it('a new image that never becomes ready rolls back only after the recorded previous digest matches', async () => {
    const h = harness(
      world({ readyByTag: { [TAG]: [{ status: 503, json: { status: 'starting' } }] } }),
    );
    const out = await runRelease(h.input(), h.adapters);
    // The previous image is READY immediately in this world, so the rollback barrier passes.
    expect(out).toMatchObject({ result: 'ROLLED_BACK' });
    expect(out.reason).toMatch(/RELEASE_READY_TIMEOUT/);
    const tampered = harness(
      world({
        readyByTag: { [TAG]: [{ status: 503, json: { status: 'starting' } }] },
        images: {
          ...world().images,
          [`kkakkung-game:${PREV_TAG}`]: { id: digest('9'), revision: 'b'.repeat(40) },
        },
      }),
    );
    const blocked = await runRelease(tampered.input(), tampered.adapters);
    expect(blocked).toMatchObject({
      result: 'ROLLBACK_BLOCKED',
      phase: 'ROLLBACK_BLOCKED',
      reason: 'PREVIOUS_DIGEST_MISMATCH',
      exitCode: 1,
    });
    expect(tampered.calls.compose).toEqual([TAG]);
  });

  it('a rollback image that also fails ready, or a rollback drain that times out, is ROLLBACK_BLOCKED', async () => {
    const bothFail = harness(
      world({ readySequence: [{ status: 503, json: { status: 'starting' } }], running: {} }),
    );
    expect(await runRelease(bothFail.input(), bothFail.adapters)).toMatchObject({
      result: 'ROLLBACK_BLOCKED',
      reason: 'ROLLBACK_READY_TIMEOUT',
    });
    const w = world({ smokeCodes: { [TAG]: 1 } });
    let drains = 0;
    const drainQueue = () =>
      ++drains === 1
        ? [{ status: 'succeeded' as const, code: null }]
        : [{ status: 'pending' as const }];
    const h = harness(w);
    const original = h.adapters.http;
    const adapters: ReleaseAdapters = {
      ...h.adapters,
      http: async (method, url, options) => {
        if (method === 'POST' && (options?.body as { action?: string })?.action === 'drain')
          w.drainSnapshots = drainQueue();
        return original(method, url, options);
      },
    };
    const out = await runRelease(h.input(), adapters);
    expect(out).toMatchObject({ result: 'ROLLBACK_BLOCKED', reason: 'ROLLBACK_DRAIN_TIMEOUT' });
    expect(h.calls.compose).toEqual([TAG]);
    expect(out.detail).toMatch(/SMOKE_FAILED/);
  });

  it('no previous release means ROLLBACK_BLOCKED, never a forced swap', async () => {
    const h = harness(world({ smokeCodes: { [TAG]: 1 } }));
    const out = await runRelease(h.input({ manifest: manifest({ previous: null }) }), h.adapters);
    expect(out).toMatchObject({ result: 'ROLLBACK_BLOCKED', reason: 'NO_PREVIOUS_RELEASE' });
    expect(h.calls.compose).toEqual([TAG]);
  });

  it('smoke passes but an unresolved retirement or a stale official budget refuses publication without rollback', async () => {
    const unresolved = harness(
      world({ statusAfterResume: { ...world().statusAfterResume, unresolvedCount: 1 } }),
    );
    const out = await runRelease(unresolved.input(), unresolved.adapters);
    expect(out).toMatchObject({
      result: 'PUBLISH_BLOCKED',
      reason: 'PUBLICATION_CONDITIONS',
      exitCode: 1,
      lastGoodWritten: false,
    });
    expect(unresolved.calls.compose).toEqual([TAG]);
    const stale = harness(
      world({ statusAfterResume: { ...world().statusAfterResume, checkedAtEpochMs: 0 } }),
    );
    expect(
      (
        await runRelease(
          stale.input({ manifest: manifest({ officialBudgetMaxAgeMs: 1000 }) }),
          stale.adapters,
        )
      ).detail,
    ).toMatch(/official budget check older/);
    const never = harness(
      world({ statusAfterResume: { ...world().statusAfterResume, checkedAtEpochMs: null } }),
    );
    expect((await runRelease(never.input(), never.adapters)).detail).toMatch(/never checked/);
  });

  it('a compose failure or a swap that left another image running rolls back', async () => {
    const composeFail = harness(world({ composeCodes: { [TAG]: 1 } }));
    const out = await runRelease(composeFail.input(), composeFail.adapters);
    expect(out).toMatchObject({ result: 'ROLLED_BACK' });
    expect(out.reason).toMatch(/RELEASE_COMPOSE_FAILED/);
    const wrongImage = harness(
      world({ running: { ...world().running, [TAG]: { game: digest('7'), web: digest('2') } } }),
    );
    const mismatch = await runRelease(wrongImage.input(), wrongImage.adapters);
    expect(mismatch.reason).toMatch(/RELEASE_SWAP_MISMATCH/);
  });

  it.each([undefined, '1000000', Number.NaN, -1, 1_000_001])(
    'refuses publication with missing, malformed or future official timestamp: %s',
    async (checkedAtEpochMs) => {
      const h = harness(
        world({ statusAfterResume: { ...world().statusAfterResume, checkedAtEpochMs } }),
      );
      const out = await runRelease(h.input(), h.adapters);
      expect(out).toMatchObject({ result: 'PUBLISH_BLOCKED', lastGoodWritten: false });
      expect(out.detail).toContain('timestamp invalid');
    },
  );
});

describe('skeleton profile (operations not integrated yet)', () => {
  it('records drain NOT_RUN, runs the HTTP smoke, and never claims READY', async () => {
    const h = harness(
      world({
        ops: 'unavailable',
        readySequence: [{ status: 200, json: { status: 'ready', mediaEnabled: false } }],
      }),
    );
    const out = await runRelease(
      h.input({
        manifest: manifest({ profile: 'skeleton' }),
        opsTokenPresent: false,
        smokePreflightPresent: false,
      }),
      h.adapters,
    );
    expect(out).toMatchObject({
      result: 'DEPLOYED_WITHOUT_OPERATIONS',
      phase: 'SMOKE',
      exitCode: 0,
      lastGoodWritten: true,
    });
    expect(h.calls.posts).toEqual([]);
    expect(h.calls.smoke).toEqual(['http']);
    expect(out.steps.find((s) => s.name === 'drain')?.status).toBe('NOT_RUN');
    expect(out.result).not.toBe('READY');
  });

  it('uses the full barrier when operations turn out to be available, and rolls back on an HTTP smoke failure otherwise', async () => {
    const withOps = harness(world());
    expect(
      await runRelease(
        withOps.input({ manifest: manifest({ profile: 'skeleton' }) }),
        withOps.adapters,
      ),
    ).toMatchObject({ result: 'READY' });
    const smokeFail = harness(
      world({
        ops: 'unavailable',
        smokeCodes: { [TAG]: 1 },
        readySequence: [{ status: 200, json: { status: 'ready', mediaEnabled: false } }],
      }),
    );
    const out = await runRelease(
      smokeFail.input({
        manifest: manifest({ profile: 'skeleton' }),
        opsTokenPresent: false,
        smokePreflightPresent: false,
      }),
      smokeFail.adapters,
    );
    expect(out).toMatchObject({ result: 'ROLLED_BACK', exitCode: 1 });
    expect(smokeFail.calls.compose).toEqual([TAG, PREV_TAG]);
    expect(smokeFail.calls.posts).toEqual([]);
  });
});

describe('wiring: Jenkinsfile and infra/deploy.sh go through the runner only', () => {
  const jenkinsfile = readFileSync(resolve(root, 'Jenkinsfile'), 'utf8');
  const deploySh = readFileSync(resolve(root, 'infra/deploy.sh'), 'utf8');

  it('both paths call verify-release then deploy-release and contain no direct compose up or image build', () => {
    for (const text of [jenkinsfile, deploySh]) {
      expect(text).toMatch(/scripts\/verify-release\.mjs/);
      expect(text).toMatch(/scripts\/deploy-release\.mjs/);
      expect(text).toContain('--official-budget-max-age-ms');
      expect(text).toContain('OPS_OFFICIAL_BUDGET_MAX_AGE_MS:?');
      expect(text).not.toMatch(/docker compose[^\n]*\bup\b/);
    }
    expect(deploySh).not.toMatch(/docker build/);
  });

  it('the operator token is bound only from the Secret text credential and never echoed', () => {
    expect(jenkinsfile).toContain(
      "string(credentialsId: 'kkakkung-ops-token', variable: 'OPS_TOKEN')",
    );
    expect(jenkinsfile).not.toMatch(/echo[^\n]*OPS_TOKEN/);
    expect(deploySh).not.toMatch(/echo[^\n]*OPS_TOKEN/);
  });

  it('defaults are explicit: deadlines are bounded and the skeleton profile is a named choice', () => {
    expect(DEFAULT_DEADLINES.drainMs).toBeGreaterThan(0);
    expect(jenkinsfile).toMatch(/DEPLOY_PROFILE\s*=\s*'skeleton'/);
  });
});
