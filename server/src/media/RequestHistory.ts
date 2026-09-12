/** Bounded retry history, never an authorization source. In-flight operations are pinned. */
export class RequestHistory<T extends object> {
  private readonly entries = new Map<string, { value: T; completedAt: number | null }>();
  constructor(
    private readonly now: () => number,
    private readonly limits = { maxEntries: 4096, retentionMs: 600_000 },
  ) {
    if (
      !Number.isSafeInteger(limits.maxEntries) ||
      limits.maxEntries <= 0 ||
      !Number.isSafeInteger(limits.retentionMs) ||
      limits.retentionMs <= 0
    )
      throw new Error('INVALID_REQUEST_HISTORY_LIMITS');
  }
  prune(): void {
    const now = this.now();
    for (const [id, entry] of this.entries)
      if (entry.completedAt !== null && now - entry.completedAt >= this.limits.retentionMs)
        this.entries.delete(id);
  }
  get(id: string): T | undefined {
    this.prune();
    return this.entries.get(id)?.value;
  }
  has(id: string): boolean {
    return this.get(id) !== undefined;
  }
  canAdd(id: string): boolean {
    this.prune();
    return this.entries.has(id) || this.entries.size < this.limits.maxEntries;
  }
  set(id: string, value: T): boolean {
    if (!this.canAdd(id)) return false;
    this.entries.set(id, { value, completedAt: null });
    return true;
  }
  settle(id: string, value: T): void {
    const entry = this.entries.get(id);
    if (entry?.value === value && entry.completedAt === null) entry.completedAt = this.now();
  }
  forgetCompleted(matches: (value: T) => boolean): void {
    for (const [id, entry] of this.entries)
      if (entry.completedAt !== null && matches(entry.value)) this.entries.delete(id);
  }
  get retained() {
    return {
      entries: this.entries.size,
      pending: [...this.entries.values()].filter((e) => e.completedAt === null).length,
    };
  }
}
