import { getDatabase } from "@/lib/sqlite";

const key = (ownerId?: string) => `provider-error-retry:${ownerId || "legacy"}`;

export function getProviderRetryEnabled(ownerId?: string): boolean {
  const row = getDatabase().prepare("SELECT data FROM settings WHERE key = ? AND owner_id IS ?")
    .get(key(ownerId), ownerId ?? null) as { data: string } | undefined;
  if (!row) return false;
  try { return JSON.parse(row.data).enabled === true; } catch { return false; }
}

export function saveProviderRetryEnabled(ownerId: string, enabled: boolean) {
  getDatabase().prepare("INSERT OR REPLACE INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
    .run(key(ownerId), ownerId, JSON.stringify({ enabled }));
}
