// S15P21C204-368. CI runs what a change can break, not the whole suite on every build. These
// rules are the accepted trade; the dangerous direction is a plan that silently runs too little,
// so "unknown changes" and every deploy are pinned here.
import { describe, expect, it } from 'vitest';
import {
  DP06_LOCAL_VITEST,
  HEAVY_VITEST,
  changedPaths,
  docsOnly,
  planChecks,
} from '../../scripts/ci-plan.mjs';

const ids = (changed: string[] | null) => planChecks({ mode: 'mr', changed }).map((s) => s.id);
const step = (changed: string[] | null, id: string) =>
  planChecks({ mode: 'mr', changed }).find((s) => s.id === id);
const vitestArgs = (changed: string[] | null) => step(changed, 'test')!.commands[0]!.join(' ');

describe('MR plan', () => {
  it('runs everything an MR can run when the change set is unknown', () => {
    expect(ids(null)).toEqual(['static', 'test', 'build', 'bundle', 'assets', 'e2e']);
    // 모르면 렌더링 spec 도, DP-06 로컬판도 돈다.
    expect(step(null, 'e2e')!.env).toBeUndefined();
    expect(vitestArgs(null)).not.toContain(DP06_LOCAL_VITEST);
  });

  it('never runs the heavy integration files, which every deploy runs instead', () => {
    for (const changed of [null, ['server/src/rooms/KkakkungRoom.ts'], ['apps/web/src/main.tsx']])
      for (const file of HEAVY_VITEST) expect(vitestArgs(changed)).toContain(`--exclude ${file}`);
    const deploy = planChecks({ mode: 'deploy', changed: null });
    expect(deploy.map((s) => s.id)).toEqual(['typecheck', 'heavy-integration']);
    expect(deploy[1]!.commands[0]).toEqual(['pnpm', 'test', ...HEAVY_VITEST]);
  });

  it('keeps a server-only change to static checks, vitest and build', () => {
    expect(ids(['server/src/session/SessionRoutes.ts'])).toEqual([
      'static',
      'test',
      'build',
      'bundle',
    ]);
    expect(vitestArgs(['server/src/session/SessionRoutes.ts'])).toContain(
      `--exclude ${DP06_LOCAL_VITEST}`,
    );
  });

  it('runs the browser flows for web changes and the rendering spec only for scene changes', () => {
    expect(step(['apps/web/src/features/room/LobbyScreen.tsx'], 'e2e')!.env).toEqual({
      E2E_SKIP_RENDER: '1',
    });
    expect(step(['apps/web/src/features/game/scene/RoleAvatar.tsx'], 'e2e')!.env).toBeUndefined();
    expect(step(['packages/protocol/src/game-messages/session.ts'], 'e2e')).toBeDefined();
    // 의존성은 어디서 바뀌든 개발 서버가 도는 방식을 바꿀 수 있다.
    expect(step(['server/package.json'], 'e2e')).toBeDefined();
    expect(step(['pnpm-lock.yaml'], 'e2e')!.env).toBeUndefined();
  });

  it('checks product assets only when something they read changed', () => {
    expect(ids(['apps/web/public/models/runner.glb'])).toContain('assets');
    expect(ids(['apps/web/src/features/room/LobbyScreen.tsx'])).not.toContain('assets');
  });

  it('runs the local DP-06 harness only for its own inputs', () => {
    expect(vitestArgs(['tests/cloud/DeploymentSmokeHarness.ts'])).not.toContain(DP06_LOCAL_VITEST);
    expect(vitestArgs(['scripts/deploy-release.mjs'])).not.toContain(DP06_LOCAL_VITEST);
    expect(vitestArgs(['tests/fixtures/deployment-smoke-plan.ts'])).not.toContain(
      DP06_LOCAL_VITEST,
    );
  });

  it('runs formatting and document-reading contracts for a documentation-only change', () => {
    expect(docsOnly(['docs/testing.md', 'infra/SSO.md'])).toBe(true);
    expect(docsOnly(['docs/testing.md', 'Jenkinsfile'])).toBe(false);
    expect(docsOnly([])).toBe(false);
    const plan = planChecks({ mode: 'mr', changed: ['docs/testing.md'] });
    expect(plan.map((s) => s.id)).toEqual(['format', 'contracts']);
    expect(plan[1]!.commands[0]).toEqual([
      'pnpm',
      'test',
      'tests/contracts',
      '--exclude',
      DP06_LOCAL_VITEST,
    ]);
  });

  it('runs format, lint and typecheck together and nothing tick-sensitive beside them', () => {
    const concurrent = step(['server/src/index.ts'], 'static')!.commands.map((c) => c.join(' '));
    expect(concurrent).toEqual(['pnpm format:check', 'pnpm lint', 'pnpm typecheck']);
  });

  it('reads the change set from git and reports failure as unknown', () => {
    expect(changedPaths('origin/develop', () => 'a.ts\n\nb/c.md\n')).toEqual(['a.ts', 'b/c.md']);
    expect(changedPaths('origin/develop', () => null)).toBeNull();
  });
});
