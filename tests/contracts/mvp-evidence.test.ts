// F-19 / QA-13 gate report rules on synthetic manifests: BLOCKED/NOT_RUN/PENDING never count as
// PASS, missing or foreign-commit evidence is UNVERIFIED, feature state and verified room count
// are reported apart, and publication needs isolation + cleanup + budget, not just resume/OPEN.
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_GATES,
  evaluateGates,
  injectReport,
  renderReport,
  type GateInput,
  type GateManifest,
} from '../../scripts/verify-mvp-evidence.mjs';

const HEAD = 'a'.repeat(40);
const gate = (
  g: string,
  status: GateInput['status'],
  over: Partial<GateInput> = {},
): GateInput => ({
  gate: g,
  status,
  sourceCommit: HEAD,
  environmentRef: 'cloud-poc',
  evidenceRefs: [`.local/qa/${g}.json`],
  ...over,
});
const allPass = (): GateInput[] => REQUIRED_GATES.map((g) => gate(g, 'PASS'));
const publication = {
  isolationVerified: true,
  unresolvedRetirements: 0,
  officialBudgetCheckedAt: '2026-09-10T05:00:00Z',
  smokeCleanupConfirmed: true,
  resumeOpenConfirmed: true,
  publicWindowOpen: true,
};
const manifest = (over: Partial<GateManifest> = {}): GateManifest => ({
  headCommit: HEAD,
  featureState: 'confirmed scope complete',
  capacity: { gameOnlyRooms: 10, withMediaRooms: 10 },
  gates: [...allPass(), gate('G3-C', 'PRODUCT_DECISION_PENDING', { evidenceRefs: [] })],
  publication,
  ...over,
});
const allExist = () => true;

describe('gate aggregation', () => {
  it('every required gate PASS with existing evidence on the reported commit → mvpComplete; G3-C stays pending and uncounted', () => {
    const r = evaluateGates(manifest(), allExist, HEAD);
    expect(r.summary).toMatchObject({
      pass: 11,
      blocked: 0,
      notRun: 0,
      unverified: 0,
      mvpComplete: true,
      pending: ['G3-C'],
    });
    expect(r.publication.allowed).toBe(true);
  });

  it('G1 with only local mocks and no Cloud → NOT_RUN/BLOCKED and mvpComplete false, never summed as PASS', () => {
    const r = evaluateGates(
      manifest({
        gates: [
          ...allPass().filter((g) => !g.gate.startsWith('G1')),
          gate('G1-A', 'BLOCKED'),
          gate('G1-B', 'BLOCKED'),
          gate('G1-C', 'NOT_RUN'),
          gate('G1-D', 'BLOCKED'),
        ],
      }),
      allExist,
      HEAD,
    );
    expect(r.summary).toMatchObject({ pass: 7, blocked: 3, notRun: 1, mvpComplete: false });
  });

  it('G5 complete but G6 not run → feature state and verified room count are reported apart', () => {
    const r = evaluateGates(
      manifest({
        featureState: 'features complete; 10 rooms unverified',
        capacity: { gameOnlyRooms: 5, withMediaRooms: 1 },
        gates: [...allPass().filter((g) => g.gate !== 'G6'), gate('G6', 'NOT_RUN')],
      }),
      allExist,
      HEAD,
    );
    expect(r.summary.mvpComplete).toBe(false);
    expect(r.summary.featureState).toBe('features complete; 10 rooms unverified');
    expect(r.summary.capacity).toEqual({ gameOnlyRooms: 5, withMediaRooms: 1 });
    const md = renderReport(
      r,
      manifest({ capacity: { gameOnlyRooms: 5, withMediaRooms: 1 } }),
      '2026-09-10T06:00:00Z',
    );
    expect(md).toContain('게임 단독 **5방**, 미디어 포함 **1방**');
    expect(md).toContain('MVP 완료: **false**');
  });

  it('a PASS whose evidence file is missing or from another commit is UNVERIFIED', () => {
    const missing = evaluateGates(manifest(), (ref) => !ref.includes('G4'), HEAD);
    expect(missing.gates.find((g) => g.gate === 'G4')).toMatchObject({
      status: 'UNVERIFIED',
      declared: 'PASS',
    });
    expect(missing.summary.mvpComplete).toBe(false);
    const foreign = evaluateGates(
      manifest({
        gates: [
          ...allPass().filter((g) => g.gate !== 'G2'),
          gate('G2', 'PASS', { sourceCommit: 'b'.repeat(40) }),
        ],
      }),
      allExist,
      HEAD,
    );
    expect(foreign.gates.find((g) => g.gate === 'G2')?.problems[0]).toMatch(
      /differs from the reported checkout/,
    );
    // A feature-branch commit may be declared explicitly; then it is not a mismatch.
    const branch = evaluateGates(
      manifest({
        gates: [
          ...allPass().filter((g) => g.gate !== 'G2'),
          gate('G2', 'PASS', { sourceCommit: 'b'.repeat(40), sourceCommitIsFeatureBranch: true }),
        ],
      }),
      allExist,
      HEAD,
    );
    expect(branch.gates.find((g) => g.gate === 'G2')?.status).toBe('PASS');
    const empty = evaluateGates(
      manifest({
        gates: [
          ...allPass().filter((g) => g.gate !== 'G5'),
          gate('G5', 'PASS', { evidenceRefs: [] }),
        ],
      }),
      allExist,
      HEAD,
    );
    expect(empty.gates.find((g) => g.gate === 'G5')?.problems).toContain('no evidence reference');
  });

  it('remaining UNRESOLVED or an unconfirmed official budget blocks publication even with every gate passing', () => {
    const unresolved = evaluateGates(
      manifest({ publication: { ...publication, unresolvedRetirements: 1 } }),
      allExist,
      HEAD,
    );
    expect(unresolved.summary.mvpComplete).toBe(true);
    expect(unresolved.publication).toEqual({
      allowed: false,
      problems: ['unresolved retirements: 1'],
    });
    const budget = evaluateGates(
      manifest({ publication: { ...publication, officialBudgetCheckedAt: null } }),
      allExist,
      HEAD,
    );
    expect(budget.publication.problems).toEqual(['official budget not confirmed']);
  });

  it('smoke success without cleanup evidence or isolation verification is not a publication; resume/OPEN alone never counts', () => {
    const noCleanup = evaluateGates(
      manifest({ publication: { ...publication, smokeCleanupConfirmed: false } }),
      allExist,
      HEAD,
    );
    expect(noCleanup.publication.problems).toEqual(['smoke session/media cleanup not confirmed']);
    const noIsolation = evaluateGates(
      manifest({ publication: { ...publication, isolationVerified: false } }),
      allExist,
      HEAD,
    );
    expect(noIsolation.publication.allowed).toBe(false);
    const onlyResume = evaluateGates(
      manifest({ publication: { resumeOpenConfirmed: true } }),
      allExist,
      HEAD,
    );
    expect(onlyResume.publication.allowed).toBe(false);
    expect(onlyResume.publication.problems.length).toBeGreaterThanOrEqual(4);
  });

  it('the report section replaces itself between markers and lists pending items apart from the 122-id scope', () => {
    const r = evaluateGates(manifest(), allExist, HEAD);
    const section = renderReport(r, manifest(), '2026-09-10T06:00:00Z');
    const once = injectReport('# doc\n\nbody\n', section);
    const twice = injectReport(once, renderReport(r, manifest(), '2026-09-10T07:00:00Z'));
    expect(twice.match(/mvp-gate-report:start/g)).toHaveLength(1);
    expect(twice).toContain('2026-09-10T07:00:00Z');
    expect(twice).not.toContain('2026-09-10T06:00:00Z');
    expect(section).toContain('결정 대기: G3-C');
    expect(section).not.toMatch(/122/);
  });
});
