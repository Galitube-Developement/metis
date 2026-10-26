/** Browser-safe identity defaults; callers pass only the current owner's connections. */
export function newProviderConnectionIdentity(
  providerKey: string,
  connections: readonly { slug: string }[],
): { id: string; slug: string } {
  const occupied = new Set(connections.map((connection) => connection.slug));
  const base = `${providerKey}-main`;
  let slug = base;
  for (let suffix = 2; occupied.has(slug); suffix += 1) {
    slug = `${base}-${suffix}`;
  }
  return { id: "", slug };
}
