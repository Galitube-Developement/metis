import { getDatabase, transaction } from "@/lib/sqlite";
import { normalizeAppearanceState, type AppearanceState } from "@/lib/appearance-storage";

export interface AppearanceSettingsRecord {
  ownerId: string;
  state: AppearanceState | null;
  revision: number;
}

export type SaveAppearanceSettingsResult =
  | { ok: true; record: AppearanceSettingsRecord }
  | { ok: false; record: AppearanceSettingsRecord };

function key(ownerId: string): string {
  if (!ownerId) throw new Error("An account ID is required.");
  return "appearance:" + ownerId;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER;
}

/** A missing account record permits a single legacy-browser migration at revision 0. */
export function getAppearanceSettings(ownerId: string): AppearanceSettingsRecord {
  const row = getDatabase().prepare("SELECT data FROM settings WHERE key = ? AND owner_id = ?")
    .get(key(ownerId), ownerId) as { data: string } | undefined;
  if (!row) return { ownerId, state: null, revision: 0 };
  const saved: unknown = JSON.parse(row.data);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    throw new Error("Saved appearance settings are invalid.");
  }
  const record = saved as Record<string, unknown>;
  if (record.version !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
    throw new Error("Saved appearance settings have an invalid revision.");
  }
  return { ownerId, state: normalizeAppearanceState(record.state), revision: record.revision as number };
}

/** Compare and save under a write transaction, including concurrent first migrations. */
export function saveAppearanceSettings(
  ownerId: string,
  state: unknown,
  expectedRevision: number,
): SaveAppearanceSettingsResult {
  const settingKey = key(ownerId);
  if (!validRevision(expectedRevision)) throw new Error("revision must be a non-negative safe integer.");
  const normalized = normalizeAppearanceState(state);
  return transaction<SaveAppearanceSettingsResult>(() => {
    const current = getAppearanceSettings(ownerId);
    if (current.revision !== expectedRevision) return { ok: false, record: current };
    const revision = expectedRevision + 1;
    const data = JSON.stringify({ version: 1, revision, state: normalized });
    const db = getDatabase();
    if (current.revision === 0) {
      // Never replace a key that belongs to another owner, even if the DB was
      // manually edited into an inconsistent state.
      const inserted = db.prepare("INSERT OR IGNORE INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
        .run(settingKey, ownerId, data);
      if (inserted.changes !== 1) return { ok: false, record: getAppearanceSettings(ownerId) };
    } else {
      const updated = db.prepare("UPDATE settings SET data = ? WHERE key = ? AND owner_id = ?")
        .run(data, settingKey, ownerId);
      if (updated.changes !== 1) return { ok: false, record: getAppearanceSettings(ownerId) };
    }
    return { ok: true, record: { ownerId, state: normalized, revision } };
  });
}
