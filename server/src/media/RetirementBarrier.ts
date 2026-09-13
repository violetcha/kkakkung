import type { CapabilityReport } from './CloudCapabilityProbe.js';
import type { Generation } from './MediaGenerationRegistry.js';
import { confirmRemoteRevocation } from './RemoteRevocation.js';
import type { RetireGenerationRequest, RetirementResult } from './types.js';
import { RequestHistory } from './RequestHistory.js';

export type RetirementBarrierDeps = {
  find: (input: RetireGenerationRequest) => Generation | undefined;
  capability: () => CapabilityReport | null;
  nowEpochSeconds: () => number;
  persist: (generation: Generation) => Promise<void>;
  stopPermissions: (generation: Generation) => void;
  awaitPendingPermissions?: (generation: Generation) => Promise<void>;
  remove: (generation: Generation, cutoff?: bigint) => Promise<void>;
  absent: (generation: Generation) => Promise<boolean>;
  onUnresolved: (generation: Generation) => void;
  onFailure?: (generation: Generation, error: unknown) => void;
  onConfirmed: (generation: Generation) => Promise<void>;
};
type Request = {
  fingerprint: string;
  promise: Promise<RetirementResult>;
  result?: RetirementResult;
};
const fingerprint = (input: RetireGenerationRequest) =>
  JSON.stringify([
    input.matchId,
    input.mediaInstanceId,
    input.playerId,
    input.receiverGeneration,
    input.reason,
  ]);

export class RetirementBarrier {
  private readonly pending = new Map<Generation, Promise<RetirementResult>>();
  private readonly attempted = new WeakSet<Generation>();
  private readonly requests: RequestHistory<Request>;
  constructor(private readonly deps: RetirementBarrierDeps) {
    this.requests = new RequestHistory(() => deps.nowEpochSeconds() * 1000);
  }
  prune(): void {
    this.requests.prune();
  }
  get retained() {
    return { ...this.requests.retained, pendingGenerations: this.pending.size };
  }

  retire(input: RetireGenerationRequest, retry = false): Promise<RetirementResult> {
    const captured = { ...input };
    const unknown = (): RetirementResult => ({
      ...captured,
      status: 'unknown',
      code: 'STALE_GENERATION',
    });
    const previous = this.requests.get(input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint(input)) return Promise.resolve(unknown());
      if (!retry || previous.result?.status !== 'unknown') return previous.promise;
    }
    const generation = this.deps.find(input);
    if (
      !generation ||
      generation.request.matchId !== input.matchId ||
      generation.request.mediaInstanceId !== input.mediaInstanceId ||
      generation.request.playerId !== input.playerId ||
      generation.generation !== input.receiverGeneration
    ) {
      return Promise.resolve(unknown());
    }
    let promise: Promise<RetirementResult>;
    const existing = this.pending.get(generation);
    if (existing) promise = existing.then((value) => ({ ...value, ...captured }));
    else if (generation.state === 'REVOKED')
      promise = Promise.resolve({ ...captured, status: 'confirmed', code: null });
    else if (
      generation.terminal &&
      generation.state === 'UNRESOLVED' &&
      this.attempted.has(generation) &&
      !retry
    ) {
      promise = Promise.resolve({ ...captured, status: 'unknown', code: 'RETIREMENT_UNCONFIRMED' });
    } else {
      generation.terminal = true;
      // Issuance can mark a generation unresolved before its first remote cleanup.
      this.attempted.add(generation);
      promise = this.run(captured, generation);
      this.pending.set(generation, promise);
      void promise.then(
        () => this.pending.delete(generation),
        () => this.pending.delete(generation),
      );
    }
    const request: Request = { fingerprint: fingerprint(captured), promise };
    this.requests.set(input.requestId, request);
    void promise.then(
      (result) => {
        request.result = result;
        this.requests.settle(input.requestId, request);
      },
      () => this.requests.settle(input.requestId, request),
    );
    return promise;
  }

  private async run(
    input: RetireGenerationRequest,
    generation: Generation,
  ): Promise<RetirementResult> {
    const d = this.deps;
    try {
      d.stopPermissions(generation);
      generation.state = 'REVOKING';
      await d.persist(generation);
      await confirmRemoteRevocation({
        capability: () => d.capability(),
        nowEpochSeconds: () => d.nowEpochSeconds(),
        remove: async (cutoff) => {
          // Revoke original publications promptly even if forwarding is still in flight.
          await d.remove(generation, cutoff);
          // Late known effects must finish cleanup before the final absence observation.
          await d.awaitPendingPermissions?.(generation);
        },
        absent: () => d.absent(generation),
      });
      generation.state = 'REVOKED';
      await d.persist(generation);
      await d.onConfirmed(generation);
      return { ...input, status: 'confirmed', code: null };
    } catch (error) {
      generation.state = 'UNRESOLVED';
      try {
        d.onFailure?.(generation, error);
      } catch {
        /* Internal retry hints cannot bypass the terminal latch. */
      }
      try {
        await d.persist(generation);
      } catch {
        /* The unresolved state stays terminal. */
      }
      try {
        d.onUnresolved(generation);
      } catch {
        /* Observation cannot create an unhandled rejection. */
      }
      return { ...input, status: 'unknown', code: 'RETIREMENT_UNCONFIRMED' };
    }
  }
}
