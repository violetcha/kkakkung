/**
 * Server-side map loading: reads the master template bytes, hashes them (SHA-256 of the
 * original bytes), lets A validate and derive variants, selects one variant by
 * `seed % variants.length` over variantId-sorted results, pairs it with the fallback layout
 * of the same MapSource, certifies the fallback first and then drives A's online selector
 * within a monotonic budget (100ms, 256 attempts, at most 8 candidates per `next`), yielding
 * to the event loop between batches. No topology, hash, seed or file path leaves this module.
 */
import { createHash } from 'node:crypto';
import type {
  FallbackLayout,
  LayoutSelectionInput,
  LayoutSelectionPort,
  LayoutSelectionResult,
  LayoutTemplate,
  MapPreparationPort,
  MapSource,
  Role,
} from './ports.js';

export const LAYOUT_BUDGET = { budgetMs: 100, maxAttempts: 256, maxBatch: 8 } as const;

export type LoaderFailure = Readonly<{
  status: 'unavailable';
  code: 'LAYOUT_UNAVAILABLE' | 'LOADER_FAILED';
  /** Internal diagnostic; never sent to clients. */
  diagnostic: string;
}>;

export type LayoutPreparation =
  | Readonly<{
      status: 'selected';
      layout: LayoutSelectionResult & { status: 'selected' };
      source: MapSource;
    }>
  | LoaderFailure;

export type LayoutLoaderDeps = Readonly<{
  readFile: (path: string) => Promise<Uint8Array>;
  maps: MapPreparationPort;
  selection: LayoutSelectionPort;
  now: () => number;
  yieldToEventLoop?: () => Promise<void>;
  budgetMs?: number;
  maxAttempts?: number;
  maxBatch?: number;
}>;

export type PrepareLayoutInput = Readonly<{
  masterPath: string;
  fallbackPath: string;
  templateId: string;
  templateVersion: string;
  players: readonly { playerId: string; role: Role }[];
  seed: number;
}>;

const defaultYield = () => new Promise<void>((resolve) => setImmediate(resolve));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameSource(a: MapSource, b: Record<string, unknown>) {
  return (
    b.templateId === a.templateId &&
    b.templateVersion === a.templateVersion &&
    b.templateHash === a.templateHash &&
    b.variantId === a.variantId
  );
}

export class LayoutLoader {
  constructor(private readonly deps: LayoutLoaderDeps) {}

  async prepare(input: PrepareLayoutInput): Promise<LayoutPreparation> {
    const fail = (code: LoaderFailure['code'], diagnostic: string): LoaderFailure => ({
      status: 'unavailable',
      code,
      diagnostic,
    });
    let masterBytes: Uint8Array;
    try {
      masterBytes = await this.deps.readFile(input.masterPath);
    } catch {
      return fail('LOADER_FAILED', 'master-read');
    }
    const templateHash = createHash('sha256').update(masterBytes).digest('hex');
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(masterBytes).toString('utf8'));
    } catch {
      return fail('LOADER_FAILED', 'master-json');
    }
    const source: MapSource = {
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      templateHash,
      variantId: 'r0',
    };
    const validated = this.deps.maps.validateTemplate(raw, source);
    if (validated.status !== 'valid')
      return fail('LOADER_FAILED', `template:${validated.code}:${validated.path.join('.')}`);
    const variants = this.deps.maps.createTemplateVariants(validated.template);
    if (variants.status !== 'valid') return fail('LOADER_FAILED', `variants:${variants.code}`);
    if (variants.variants.length === 0) return fail('LOADER_FAILED', 'variants:empty');
    const sorted = [...variants.variants].sort((a, b) =>
      a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
    );
    if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff)
      return fail('LOADER_FAILED', 'seed');
    const template = sorted[input.seed % sorted.length]!;
    const fallback = await this.readFallback(input.fallbackPath, template);
    if (!fallback) return fail('LOADER_FAILED', 'fallback-structure');
    const selectionInput: LayoutSelectionInput = {
      template,
      players: input.players,
      seed: input.seed,
      maxAttempts: this.deps.maxAttempts ?? LAYOUT_BUDGET.maxAttempts,
      fallback,
    };
    const certified = this.deps.selection.certifyFallback(selectionInput);
    const result = await this.runSelector(selectionInput, certified);
    if (result.status === 'selected') {
      return {
        status: 'selected',
        layout: result,
        source: {
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          templateHash: template.templateHash,
          variantId: template.variantId,
        },
      };
    }
    return fail(
      'LAYOUT_UNAVAILABLE',
      certified.status === 'selected' ? 'online-unavailable' : 'fallback-uncertified',
    );
  }

  private async readFallback(
    path: string,
    template: LayoutTemplate,
  ): Promise<FallbackLayout | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(await this.deps.readFile(path)).toString('utf8'));
    } catch {
      return null;
    }
    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.fallbacks)
        ? parsed.fallbacks
        : [parsed];
    for (const candidate of candidates) {
      if (!isRecord(candidate) || !isRecord(candidate.layout)) continue;
      if (!sameSource(template, candidate)) continue;
      const layout = candidate.layout;
      if (
        !Array.isArray(layout.players) ||
        !Array.isArray(layout.exits) ||
        !Array.isArray(layout.territories) ||
        !isRecord(layout.topology)
      )
        continue;
      return {
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        templateHash: template.templateHash,
        variantId: template.variantId,
        layout: layout as unknown as FallbackLayout['layout'],
      };
    }
    return null;
  }

  private async runSelector(
    input: LayoutSelectionInput,
    certified: LayoutSelectionResult,
  ): Promise<LayoutSelectionResult> {
    const budgetMs = this.deps.budgetMs ?? LAYOUT_BUDGET.budgetMs;
    const maxBatch = this.deps.maxBatch ?? LAYOUT_BUDGET.maxBatch;
    const yieldToEventLoop = this.deps.yieldToEventLoop ?? defaultYield;
    const iterator = this.deps.selection.selectWithFallback(input);
    const startedAt = this.deps.now();
    let attempted = 0;
    for (;;) {
      if (this.deps.now() - startedAt > budgetMs || attempted >= input.maxAttempts) {
        const closed = iterator.return(certified);
        return closed.done && closed.value ? closed.value : certified;
      }
      const step = iterator.next();
      if (step.done) return step.value;
      const progress = step.value;
      if (
        !Number.isInteger(progress.attempted) ||
        !Number.isInteger(progress.batchAttempts) ||
        progress.batchAttempts < 1 ||
        progress.batchAttempts > maxBatch ||
        progress.attempted < attempted + 1 ||
        progress.attempted - attempted !== progress.batchAttempts
      ) {
        iterator.return(certified);
        return { status: 'unavailable', code: 'LAYOUT_UNAVAILABLE' };
      }
      attempted = progress.attempted;
      await yieldToEventLoop();
    }
  }
}
