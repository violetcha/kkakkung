const ownedSnapshots = new WeakSet<object>();

/** Freeze an owned JSON snapshot, never the mutable producer state. */
export function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !ownedSnapshots.has(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
    ownedSnapshots.add(value);
  }
  return value;
}

/** Only our recursively frozen owned snapshots qualify for reference reuse. */
export function isImmutableSnapshot(value: unknown): boolean {
  return typeof value === 'object' && value !== null && ownedSnapshots.has(value);
}
