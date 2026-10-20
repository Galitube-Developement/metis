// Reject oversized cache copies; the server remains the source of chat history.
export function estimateSnapshotBytes(value: unknown, limit: number): number {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  let bytes = 0;
  let visited = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++visited > 50_000) return limit + 1;
    if (typeof item === "string") bytes += item.length * 2;
    else if (item && typeof item === "object" && !seen.has(item)) {
      seen.add(item);
      bytes += 64;
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        bytes += key.length * 2 + 8;
        if (bytes > limit || pending.length >= 50_000) return limit + 1;
        pending.push((item as Record<string, unknown>)[key]);
      }
    } else bytes += 8;
    if (bytes > limit) return limit + 1;
  }
  return bytes;
}

/** Enforce count and byte budgets on every write, including prefetch/background updates. */
export class BoundedSnapshotCache<K, V> extends Map<K, V> {
  private readonly sizes = new Map<K, number>();
  constructor(
    private readonly protectedKeys: () => Iterable<K> = () => [],
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) { super(); }

  override set(key: K, value: V): this {
    const size = estimateSnapshotBytes(value, this.maxBytes);
    this.delete(key);
    if (size > this.maxBytes) return this;
    super.set(key, value);
    this.sizes.set(key, size);
    const keep = new Set(this.protectedKeys());
    const overBudget = () => this.size > this.maxEntries || [...this.sizes.values()].reduce((sum, bytes) => sum + bytes, 0) > this.maxBytes;
    for (const candidate of this.keys()) {
      if (!overBudget()) break;
      if (!keep.has(candidate)) this.delete(candidate);
    }
    // A protected snapshot may itself consume the budget. Never grow without bound.
    for (const candidate of this.keys()) {
      if (!overBudget()) break;
      this.delete(candidate);
    }
    return this;
  }
  override delete(key: K): boolean { this.sizes.delete(key); return super.delete(key); }
  override clear(): void { this.sizes.clear(); super.clear(); }
}
