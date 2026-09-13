// Type surface of scripts/verify-mvp-evidence.mjs for tests/contracts/mvp-evidence.test.ts.
export type GateStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN' | 'PRODUCT_DECISION_PENDING';
export type GateInput = Readonly<{
  gate: string;
  status: GateStatus;
  sourceCommit?: string;
  sourceCommitIsFeatureBranch?: boolean;
  environmentRef?: string;
  evidenceRefs?: readonly string[];
  evidenceSha256?: Record<string, string>;
  measuredLimits?: Record<string, string | number>;
  defects?: readonly string[];
}>;
export type GateManifest = Readonly<{
  headCommit?: string;
  featureState?: string;
  capacity?: Readonly<{ gameOnlyRooms: number; withMediaRooms: number }>;
  gates: readonly GateInput[];
  publication?: Readonly<{
    evidenceRef?: string;
    evidenceSha256?: Record<string, string>;
    isolationVerified?: boolean;
    unresolvedRetirements?: number;
    officialBudgetCheckedAt?: string | null;
    smokeCleanupConfirmed?: boolean;
    resumeOpenConfirmed?: boolean;
    publicWindowOpen?: boolean;
  }>;
}>;
export type GateResult = Readonly<{
  gate: string;
  status: GateStatus | 'UNVERIFIED';
  declared: GateStatus;
  sourceCommit: string | null;
  environmentRef: string | null;
  evidenceRefs: readonly string[];
  measuredLimits: Record<string, string | number>;
  defects: readonly string[];
  problems: string[];
}>;
export type Evaluation = Readonly<{
  gates: GateResult[];
  summary: Readonly<{
    required: number;
    pass: number;
    fail: number;
    blocked: number;
    notRun: number;
    unverified: number;
    requiredMissing: string[];
    pending: string[];
    mvpComplete: boolean;
    featureState: string;
    capacity: Readonly<{ gameOnlyRooms: number; withMediaRooms: number }>;
    declaredCapacity: Readonly<{ gameOnlyRooms: number; withMediaRooms: number }> | null;
    manifestProblems: string[];
  }>;
  release: Readonly<{
    ready: boolean;
    audience: string;
    operatingMode: string;
    problems: string[];
  }>;
  publication: Readonly<{ allowed: boolean; problems: string[] }>;
}>;
export const GATE_STATUSES: readonly GateStatus[];
export const REQUIRED_GATES: readonly string[];
export const PENDING_GATES: readonly string[];
export type EvidenceReader = (ref: string) => { document: unknown; sha256: string } | null;
export function evaluateGates(
  manifest: GateManifest,
  read: EvidenceReader,
  headCommit: string | null,
  options?: { lockfileHash?: string; nowEpochMs?: number },
): Evaluation;
export function renderReport(
  result: Evaluation,
  manifest: GateManifest,
  generatedAt: string,
): string;
export function injectReport(markdown: string, section: string): string;
