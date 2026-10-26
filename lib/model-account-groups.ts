import { parseModelKey } from "@/lib/providers/types";

export type AccountModel = {
  id: string; providerId?: string; providerName?: string;
  connectionId?: string; connectionLabel?: string;
};
export type ModelAccountGroup = {
  value: string; providerId: string; connectionId?: string; label: string;
};
type Connection = { id: string; providerKey: string; label: string; enabled?: boolean };

export function modelAccountKey(model: AccountModel): string {
  const parsed = parseModelKey(model.id);
  const providerId = model.providerId || parsed.providerKey;
  const connectionId = model.connectionId || parsed.connectionId;
  return connectionId ? providerId + ":" + connectionId : providerId;
}

/** Account identity stays stable when the user renames a connection. */
export function modelAccountGroups(models: AccountModel[], connections: Connection[] = []): ModelAccountGroup[] {
  const groups = new Map<string, ModelAccountGroup>();
  for (const connection of connections) {
    if (connection.enabled === false) continue;
    const model = models.find(item => item.connectionId === connection.id);
    const value = connection.providerKey + ":" + connection.id;
    groups.set(value, { value, providerId: connection.providerKey, connectionId: connection.id,
      label: connection.label || model?.connectionLabel || model?.providerName || connection.providerKey });
  }
  for (const model of models) {
    const parsed = parseModelKey(model.id);
    const providerId = model.providerId || parsed.providerKey;
    const connectionId = model.connectionId || parsed.connectionId;
    const value = modelAccountKey(model);
    if (!groups.has(value)) groups.set(value, { value, providerId, connectionId,
      label: model.connectionLabel || model.providerName || providerId });
  }
  const result = [...groups.values()];
  const counts = new Map<string, number>(), seen = new Map<string, number>();
  for (const group of result) counts.set(group.label, (counts.get(group.label) || 0) + 1);
  return result.map(group => {
    if ((counts.get(group.label) || 0) < 2) return group;
    const ordinal = (seen.get(group.label) || 0) + 1;
    seen.set(group.label, ordinal);
    return { ...group, label: group.label + " (" + ordinal + ")" };
  });
}

export function modelMatchesAccount(model: AccountModel, filter: string): boolean {
  return filter === "all" || modelAccountKey(model) === filter ||
    (model.providerId || parseModelKey(model.id).providerKey) === filter;
}
