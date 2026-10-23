import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import path from "node:path";
import { migrateNoteHierarchy, previewNoteHierarchyMigration, rollbackNoteHierarchyMigration } from "../lib/note-hierarchy-migration";

const { values } = parseArgs({
  options: {
    database: { type: "string" }, "backup-dir": { type: "string" },
    apply: { type: "boolean" }, rollback: { type: "boolean" }, "dry-run": { type: "boolean" },
  },
});
if (!values.database || [values.apply, values.rollback, values["dry-run"]].filter(Boolean).length > 1) {
  throw new Error("Usage: npx tsx scripts/migrate-note-hierarchy.ts --database /absolute/chat.sqlite [--dry-run|--apply|--rollback] [--backup-dir /absolute/backups]");
}
const databasePath = path.resolve(values.database);
const db = new DatabaseSync(databasePath, { readOnly: !values.apply && !values.rollback });
try {
  db.exec("PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON");
  const result = values.apply
    ? migrateNoteHierarchy(db, { databasePath, backupDir: values["backup-dir"] ? path.resolve(values["backup-dir"]) : undefined })
    : values.rollback ? rollbackNoteHierarchyMigration(db) : previewNoteHierarchyMigration(db);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally { db.close(); }
