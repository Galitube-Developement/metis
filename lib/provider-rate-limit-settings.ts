import { getDatabase } from "@/lib/sqlite";
const key = (ownerId?: string) => `provider-limit-resume:${ownerId || "legacy"}`;
export function getProviderLimitResumeEnabled(ownerId?: string): boolean {
  const row = getDatabase().prepare("SELECT data FROM settings WHERE key = ? AND owner_id IS ?")
    .get(key(ownerId), ownerId ?? null) as { data: string } | undefined;
  if (!row) return true;
  try { return JSON.parse(row.data).enabled !== false; } catch { return true; }
}
export function saveProviderLimitResumeEnabled(ownerId: string, enabled: boolean) {
  getDatabase().prepare("INSERT OR REPLACE INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
    .run(key(ownerId), ownerId, JSON.stringify({ enabled }));
}
