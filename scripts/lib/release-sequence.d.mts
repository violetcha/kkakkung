// Type surface of scripts/lib/release-sequence.mjs for tests/contracts/deployment-sequence.test.ts.
export type ReleasePhase =
  'BLOCKED' | 'DRAINING' | 'DEPLOYING' | 'RECOVERING' | 'SMOKE' | 'READY' | 'ROLLBACK_BLOCKED';
export type ReleaseResult =
  | 'READY'
  | 'DEPLOYED_WITHOUT_OPERATIONS'
  | 'ROLLED_BACK'
  | 'FAILED'
  | 'BLOCKED'
  | 'PUBLISH_BLOCKED'
  | 'ROLLBACK_BLOCKED';
export type ReleaseImage = Readonly<{ ref: string; digest: string; revision: string }>;
export type ReleaseManifest = Readonly<{
  releaseSha: string;
  tag: string;
  verifiedSha: string;
  profile: 'product' | 'skeleton';
  images: Readonly<{ game: ReleaseImage; web: ReleaseImage }>;
  previous: Readonly<{
    tag: string;
    images: Readonly<{ game: { digest: string }; web: { digest: string } }>;
  }> | null;
  officialBudgetMaxAgeMs?: number | null;
}>;
export type HttpResponse = Readonly<{ status: number; json: unknown; error?: string }>;
export type ReleaseAdapters = Readonly<{
  http: (
    method: 'GET' | 'POST',
    url: string,
    options?: Readonly<{ bearer?: boolean; body?: unknown }>,
  ) => Promise<HttpResponse>;
  inspectImage: (ref: string) => Promise<Readonly<{ id: string; revision: string | null }> | null>;
  runningImage: (service: 'game' | 'web') => Promise<string | null>;
  compose: (tag: string) => Promise<Readonly<{ code: number }>>;
  runSmoke: (mode: 'cloud' | 'http') => Promise<Readonly<{ code: number }>>;
  writeState: (name: string, text: string) => Promise<void> | void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log?: (line: string) => void;
  onStep?: (state: Readonly<{ phase: ReleasePhase; steps: readonly ReleaseStep[] }>) => void;
}>;
export type ReleaseStep = Readonly<{
  at: number;
  phase: ReleasePhase;
  name: string;
  status: 'PASS' | 'FAIL' | 'INFO' | 'NOT_RUN';
  detail: string | null;
}>;
export type ReleaseInput = Readonly<{
  manifest: ReleaseManifest;
  baseUrl: string;
  localUrl: string;
  opsTokenPresent: boolean;
  smokePreflightPresent: boolean;
  nowEpochMs: () => number;
  deadlines?: Partial<
    Readonly<{ drainMs: number; readyMs: number; recoverMs: number; resumeMs: number }>
  >;
}>;
export type ReleaseOutcome = Readonly<{
  phase: ReleasePhase;
  result: ReleaseResult;
  reason: string | null;
  detail: string | null;
  steps: readonly ReleaseStep[];
  exitCode: 0 | 1 | 3;
  lastGoodWritten: boolean;
}>;
export const RELEASE_PHASES: readonly ReleasePhase[];
export const RELEASE_RESULTS: readonly ReleaseResult[];
export const DEFAULT_DEADLINES: Readonly<{
  drainMs: number;
  readyMs: number;
  recoverMs: number;
  resumeMs: number;
}>;
export function validateManifest(manifest: unknown): string[];
export function runRelease(input: ReleaseInput, adapters: ReleaseAdapters): Promise<ReleaseOutcome>;
