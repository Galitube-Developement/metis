/**
 * Reuse derived transcript data across unrelated menu/pointer renders.
 * Weak keys let removed messages and their derived data be collected.
 * Dependencies also invalidate in-place legacy edits without a deep comparison.
 */
export function createMessageDerivationCache<T extends object>() {
  const entries = new WeakMap<T, { dependencies: readonly unknown[]; value: unknown }>();
  return function derive<V>(message: T, dependencies: readonly unknown[], compute: () => V): V {
    const entry = entries.get(message);
    if (entry && entry.dependencies.length === dependencies.length &&
        entry.dependencies.every((value, index) => Object.is(value, dependencies[index]))) {
      return entry.value as V;
    }
    const value = compute();
    entries.set(message, { dependencies: [...dependencies], value });
    return value;
  };
}
