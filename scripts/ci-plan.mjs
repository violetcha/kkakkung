#!/usr/bin/env node
// Owned by F (DP-04). S15P21C204-368. Which checks one CI build runs.
//
// Local `pnpm verify` stays the full suite. CI no longer runs all of it on every build: an MR
// build runs what its changed files can break, and a deploy build runs the heavy integration
// tests that MR builds leave out. The trade was accepted on purpose (2026-09-23): a change that
// breaks something outside these path rules is caught later — at deploy verification, by the real
// deployment smoke (DP-06) with automatic rollback, or by the next MR that touches the area.
//
// Measured on kkakkung-mr #318~#324: e2e 12.5 min of which facility-rendering 8.9 min, vitest
// 195 s held by three files (product-integration 153 s, deployment-smoke-integration 126 s,
// demo-scenarios 76 s of 520 s total). Deploys queued behind those builds on the host lock and
// three hit the 40 minute timeout (kkakkung #228, #234, #235).
//
// Not knowing what changed (`changed === null`) always means the full MR plan.

/** Long integration files. MR builds skip them; every deploy build runs them. */
export const HEAVY_VITEST = Object.freeze([
  'server/test/media/product-integration.test.ts',
  'server/test/room/demo-scenarios.test.ts',
]);
/** Local DP-06 harness. The real DP-06 runs on every deploy, so MRs run it only for its inputs. */
export const DP06_LOCAL_VITEST = 'tests/contracts/deployment-smoke-integration.test.ts';
/** Software-WebGL rendering spec, 8.9 of 12.5 e2e minutes. */
export const RENDER_E2E = 'tests/e2e/facility-rendering.spec.ts';

const DEPENDENCIES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml'];

/** Anything the browser flows under tests/e2e can depend on. */
export const WEB_PATHS = Object.freeze([
  'apps/web/',
  'packages/protocol/',
  'tests/e2e/',
  'playwright.config.ts',
  'scripts/dev.mjs',
  ...DEPENDENCIES,
]);
/** What the rendering spec draws: the 3D scene, avatars and the /preview harness around them. */
export const RENDER_PATHS = Object.freeze([
  'apps/web/src/features/game/scene/',
  'apps/web/src/app/PreviewApp.tsx',
  'apps/web/src/app/RenderPreview.tsx',
  'apps/web/src/app/MeshyAvatarPreview.tsx',
  'apps/web/public/models/',
  'apps/web/public/textures/',
  'apps/web/package.json',
  RENDER_E2E,
  'playwright.config.ts',
  ...DEPENDENCIES,
]);
/** What `check:product-assets` reads: shipped public files, the pose worker and avatar manifests. */
export const ASSET_PATHS = Object.freeze([
  'apps/web/public/',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'apps/web/package.json',
  'apps/web/src/features/game/pose/',
  'apps/web/src/features/game/scene/',
  'scripts/check-product-assets.mjs',
  'scripts/lib/vision-asset-notices.mjs',
  ...DEPENDENCIES,
]);
/** The local DP-06 harness and the release scripts it stands in for. */
export const DP06_PATHS = Object.freeze([
  'tests/cloud/',
  'tests/fixtures/deployment-',
  'tests/contracts/deployment-smoke-integration.test.ts',
  'server/test/media/product-server-process',
  'scripts/deploy-release.mjs',
  'scripts/product-release.mjs',
  'scripts/lib/deployment-smoke-preflight.mjs',
  'scripts/lib/smoke-target.mjs',
  ...DEPENDENCIES,
]);

const matches = (paths) => (file) =>
  paths.some((path) =>
    path.endsWith('/') || path.endsWith('-') ? file.startsWith(path) : file === path,
  );
const isManifest = (file) => file === 'package.json' || file.endsWith('/package.json');

/** Documentation only: prose cannot break a build, but contract tests do read some of it. */
export function docsOnly(files) {
  return (
    files.length > 0 && files.every((file) => file.endsWith('.md') || file.startsWith('docs/'))
  );
}

/**
 * The ordered plan. Each step is `{ id, commands, env? }`; commands inside one step run concurrently.
 * `mode` is `mr` or `deploy`; `changed` is the list of changed paths or null when unknown.
 */
export function planChecks({ mode, changed }) {
  if (mode === 'deploy')
    return [
      { id: 'typecheck', commands: [['pnpm', 'typecheck']] },
      { id: 'heavy-integration', commands: [['pnpm', 'test', ...HEAVY_VITEST]] },
    ];
  if (mode !== 'mr') throw new Error(`unknown mode: ${mode}`);

  const known = changed !== null;
  const any = (paths) => !known || changed.some((file) => matches(paths)(file));
  const manifests = !known || changed.some(isManifest);

  if (known && docsOnly(changed))
    return [
      { id: 'format', commands: [['pnpm', 'format:check']] },
      // Some contracts read documents (asset ledger, CI notes). The DP-06 harness never does.
      {
        id: 'contracts',
        commands: [['pnpm', 'test', 'tests/contracts', '--exclude', DP06_LOCAL_VITEST]],
      },
    ];

  const excluded = [...HEAVY_VITEST, ...(any(DP06_PATHS) ? [] : [DP06_LOCAL_VITEST])];
  const plan = [
    // No tick-sensitive test runs here, so sharing the CPU is safe (unlike vitest).
    {
      id: 'static',
      commands: [
        ['pnpm', 'format:check'],
        ['pnpm', 'lint'],
        ['pnpm', 'typecheck'],
      ],
    },
    {
      id: 'test',
      commands: [['pnpm', 'test', ...excluded.flatMap((file) => ['--exclude', file])]],
    },
    { id: 'build', commands: [['pnpm', 'build']] },
  ];
  if (any(ASSET_PATHS)) plan.push({ id: 'assets', commands: [['pnpm', 'check:product-assets']] });
  // A dependency change anywhere can change what the dev server runs under the browser flows.
  if (any(WEB_PATHS) || manifests)
    plan.push({
      id: 'e2e',
      commands: [['pnpm', 'test:e2e']],
      ...(any(RENDER_PATHS) ? {} : { env: { E2E_SKIP_RENDER: '1' } }),
    });
  return plan;
}

/** Paths this build changes against `base` (working tree included), or null when unknown. */
export function changedPaths(base, run) {
  const listed = run(['diff', '--name-only', base]);
  if (listed === null) return null;
  return listed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
