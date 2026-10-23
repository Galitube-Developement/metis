import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NOTE_PROJECT_DELETE_TRIGGER_SQL } from "@/lib/note-hierarchy-schema";

export const NOTE_HIERARCHY_MIGRATION_KEY = "note_hierarchy_v1";
type NoteRow = { id: string; owner_id: string | null; data: string; version: number; updated_at: string };
type Plan = { before: NoteRow; data: string; version: number; updatedAt: string };
type Summary = { changed: number; rehomedIds: string[]; detachedIds: string[]; excludedLearnedFacts: number };
type Marker = Summary & { completedAt: string; backupPath: string; formatVersion: 1 };

function hasMeta(db: DatabaseSync) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
}
export function noteHierarchyMigrationMarker(db: DatabaseSync): Marker | null {
  if (!hasMeta(db)) return null;
  const row = db.prepare("SELECT value FROM meta WHERE key=?").get(NOTE_HIERARCHY_MIGRATION_KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as Marker : null;
}
function transaction<T>(db: DatabaseSync, operation: () => T): T {
  if (db.isTransaction) throw new Error("Run the note migration outside an existing transaction.");
  db.exec("BEGIN IMMEDIATE");
  try { const result = operation(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

function planMigration(db: DatabaseSync) {
  const projects = new Set((db.prepare("SELECT id FROM projects").all() as Array<{ id: string }>).map(row => row.id));
  const rows = db.prepare("SELECT id,owner_id,data,version,updated_at FROM notes ORDER BY id").all() as NoteRow[];
  const candidates = new Map<string, { row: NoteRow; before: Record<string, unknown>; next: Record<string, unknown>; rehomed: boolean }>();
  let excludedLearnedFacts = 0;
  for (const row of rows) {
    const value: unknown = JSON.parse(row.data);
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as { id?: unknown }).id !== row.id) throw new Error("Invalid note record: " + row.id);
    const before = value as Record<string, unknown>;
    if (before.kind === "learned_fact") { excludedLearnedFacts++; continue; }
    const next = { ...before };
    const rehomed = typeof before.projectId === "string" && !!before.projectId && !projects.has(before.projectId);
    if (rehomed || typeof next.projectId !== "string" || !next.projectId) next.projectId = null;
    if (typeof next.parentId !== "string" || !next.parentId) next.parentId = null;
    if (typeof next.sortKey !== "number" || !Number.isFinite(next.sortKey)) next.sortKey = 0;
    if (typeof next.formatVersion !== "number" || !Number.isInteger(next.formatVersion) || next.formatVersion < 1) next.formatVersion = 1;
    if (next.icon === undefined) next.icon = null;
    if (next.cover === undefined) next.cover = null;
    if (next.fullWidth === undefined) next.fullWidth = false;
    if (next.favorite === undefined) next.favorite = false;
    candidates.set(row.id, { row, before, next, rehomed });
  }
  const plans: Plan[] = [], rehomedIds: string[] = [], detachedIds: string[] = [];
  const now = new Date().toISOString();
  for (const [id, candidate] of candidates) {
    const { row, before, next, rehomed } = candidate;
    if (typeof next.parentId === "string") {
      const parent = candidates.get(next.parentId);
      if (!parent || parent.next.projectId !== next.projectId || next.projectId === null && parent.row.owner_id !== row.owner_id) next.parentId = null;
    }
    const detached = typeof before.parentId === "string" && !!before.parentId && next.parentId === null;
    if (rehomed) rehomedIds.push(id);
    if (detached) detachedIds.push(id);
    const version = rehomed || detached ? row.version + 1 : row.version;
    const updatedAt = rehomed || detached ? now : row.updated_at;
    if (rehomed || detached) { next.version = version; next.updatedAt = updatedAt; }
    const data = JSON.stringify(next);
    if (data !== JSON.stringify(before)) plans.push({ before: row, data, version, updatedAt });
  }
  for (const [id, candidate] of candidates) {
    const seen = new Set([id]);
    let parent = candidate.next.parentId;
    while (typeof parent === "string") {
      if (seen.has(parent)) throw new Error("Note hierarchy contains a cycle: " + id);
      seen.add(parent);
      parent = candidates.get(parent)?.next.parentId;
    }
  }
  return { plans, summary: { changed: plans.length, rehomedIds, detachedIds, excludedLearnedFacts } satisfies Summary };
}

export function previewNoteHierarchyMigration(db: DatabaseSync) {
  const marker = noteHierarchyMigrationMarker(db);
  return marker ? { status: "already-completed" as const, ...marker } : { status: "pending" as const, ...planMigration(db).summary };
}

/** Explicit rollout step: backup first, then one marked, repeatable transaction. */
export function migrateNoteHierarchy(db: DatabaseSync, input: { databasePath: string; backupDir?: string }) {
  const previous = noteHierarchyMigrationMarker(db);
  if (previous) return { status: "already-completed" as const, ...previous };
  if (db.isTransaction) throw new Error("Run the note migration outside an existing transaction.");
  const backupDir = input.backupDir ?? path.join(path.dirname(path.resolve(input.databasePath)), "note-hierarchy-backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDir, "before-note-hierarchy-" + Date.now() + "-" + randomUUID() + ".sqlite");
  writeFileSync(backupPath, "", { mode: 0o600, flag: "wx" });
  db.prepare("VACUUM INTO ?").run(backupPath);
  chmodSync(backupPath, 0o600);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const checked = backup.prepare("PRAGMA quick_check").all() as Array<Record<string, string>>;
    if (checked.length !== 1 || Object.values(checked[0])[0] !== "ok") throw new Error("Note migration backup integrity check failed.");
  } finally { backup.close(); }
  return transaction(db, () => {
    db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    db.exec(NOTE_PROJECT_DELETE_TRIGGER_SQL);
    const marker = noteHierarchyMigrationMarker(db);
    if (marker) return { status: "already-completed" as const, ...marker };
    const { plans, summary } = planMigration(db);
    db.exec("CREATE TABLE IF NOT EXISTS note_hierarchy_migration_rows (note_id TEXT PRIMARY KEY,before_data TEXT NOT NULL,after_data TEXT NOT NULL,before_version INTEGER NOT NULL,after_version INTEGER NOT NULL,before_updated_at TEXT NOT NULL,after_updated_at TEXT NOT NULL)");
    db.prepare("DELETE FROM note_hierarchy_migration_rows").run();
    const journal = db.prepare("INSERT INTO note_hierarchy_migration_rows VALUES(?,?,?,?,?,?,?)");
    const update = db.prepare("UPDATE notes SET data=?,version=?,updated_at=? WHERE id=? AND version=?");
    for (const plan of plans) {
      journal.run(plan.before.id, plan.before.data, plan.data, plan.before.version, plan.version, plan.before.updated_at, plan.updatedAt);
      const changed = update.run(plan.data, plan.version, plan.updatedAt, plan.before.id, plan.before.version);
      if (!changed.changes) throw new Error("Note changed during migration: " + plan.before.id);
    }
    const completed: Marker = { ...summary, completedAt: new Date().toISOString(), backupPath, formatVersion: 1 };
    db.prepare("INSERT INTO meta(key,value) VALUES(?,?)").run(NOTE_HIERARCHY_MIGRATION_KEY, JSON.stringify(completed));
    return { status: "completed" as const, ...completed };
  });
}

/** Restore only migrated note rows; abort atomically if a later edit would be overwritten. */
export function rollbackNoteHierarchyMigration(db: DatabaseSync) {
  return transaction(db, () => {
    const marker = noteHierarchyMigrationMarker(db);
    if (!marker) return { status: "not-applied" as const, restored: 0 };
    const rows = db.prepare("SELECT * FROM note_hierarchy_migration_rows").all() as Array<{
      note_id: string; before_data: string; after_data: string; before_version: number; after_version: number;
      before_updated_at: string; after_updated_at: string;
    }>;
    for (const row of rows) {
      const current = db.prepare("SELECT data,version,updated_at FROM notes WHERE id=?").get(row.note_id) as { data: string; version: number; updated_at: string } | undefined;
      if (!current || current.data !== row.after_data || current.version !== row.after_version || current.updated_at !== row.after_updated_at) {
        throw new Error("Refusing to overwrite a note edited since migration: " + row.note_id);
      }
    }
    const update = db.prepare("UPDATE notes SET data=?,version=?,updated_at=? WHERE id=?");
    for (const row of rows) update.run(row.before_data, row.before_version, row.before_updated_at, row.note_id);
    db.prepare("DELETE FROM note_hierarchy_migration_rows").run();
    db.prepare("DELETE FROM meta WHERE key=?").run(NOTE_HIERARCHY_MIGRATION_KEY);
    return { status: "rolled-back" as const, restored: rows.length, backupPath: marker.backupPath };
  });
}
