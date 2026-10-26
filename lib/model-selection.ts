type SelectableModel = {
  id: string;
  legacyIds?: readonly string[];
};

/** Resolve metadata using the server's account routing for a saved legacy key. */
export function modelForSelection<T extends SelectableModel>(
  models: readonly T[],
  id: string | null | undefined,
): T | undefined {
  if (!id) return undefined;
  const exact = models.find((model) => model.id === id);
  if (exact) return exact;
  const aliases = models.filter((model) => model.legacyIds?.includes(id));
  // An ambiguous alias must never borrow another account's model contract.
  return aliases.length === 1 ? aliases[0] : undefined;
}
