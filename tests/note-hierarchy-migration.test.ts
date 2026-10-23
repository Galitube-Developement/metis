import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { migrateNoteHierarchy, noteHierarchyMigrationMarker, previewNoteHierarchyMigration, rollbackNoteHierarchyMigration } from "../lib/note-hierarchy-migration";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-note-migration-")), databasePath = path.join(root, "test.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id)); CREATE TABLE notes(id TEXT PRIMARY KEY,owner_id TEXT,chat_id TEXT,workspace_id TEXT,scope TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,archived INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE chats(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT NOT NULL)");
  db.prepare("INSERT INTO users VALUES(?)").run("owner"); db.prepare("INSERT INTO users VALUES(?)").run("member");
  db.prepare("INSERT INTO projects VALUES(?,?)").run("existing", "owner");
  const add = (id: string, ownerId = "owner", extra: Record<string, unknown> = {}) => {
    const value = { id, ownerId, scope: "global", title: id, content: "\n  exact Markdown  \n", kind: "note", version: 7, archived: true, createdAt: "2026-01-01", updatedAt: "2026-01-02", ...extra };
    db.prepare("INSERT INTO notes VALUES(?,?,NULL,NULL,?,?,?,?,?,?)").run(id, ownerId, "global", JSON.stringify(value), 7, value.archived ? 1 : 0, value.createdAt, value.updatedAt);
    return value;
  };
  add("legacy", "owner", { asset: { id: "same-asset", name: "saved.bin" }, todos: [{ id: "task", content: "Keep checklist", status: "completed" }] });
  add("project", "owner", { projectId: "existing", sortKey: 88 });
  add("ghost-root", "owner", { projectId: "deleted" });
  add("ghost-member", "member", { projectId: "deleted", parentId: "ghost-root" });
  add("ghost-grandchild", "member", { projectId: "deleted", parentId: "ghost-member" });
  add("fact", "owner", { projectId: "deleted", kind: "learned_fact" });
  db.prepare("INSERT INTO chats VALUES(?,?)").run("chat", JSON.stringify({ sessionState: { pinnedNoteIds: ["legacy", "ghost-root"] } }));
  db.prepare("INSERT INTO settings VALUES(?,?)").run("owner", JSON.stringify({ pinnedNoteIds: ["legacy"] }));
  const attachmentPath = path.join(root, "saved-attachment.bin"); writeFileSync(attachmentPath, new Uint8Array([0, 1, 2, 255]));
  return { db, root, databasePath, add, attachmentPath, close: () => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}
const rows = (db: DatabaseSync) => db.prepare("SELECT * FROM notes ORDER BY id").all();
const note = (db: DatabaseSync, id: string) => JSON.parse((db.prepare("SELECT data FROM notes WHERE id=?").get(id) as { data: string }).data);

test("explicit migration backs up WAL data, preserves records and pins, repairs ghost trees, and runs once", () => {
  const f = fixture();
  try {
    const before = rows(f.db), fact = note(f.db, "fact");
    const chat = f.db.prepare("SELECT data FROM chats").get(), settings = f.db.prepare("SELECT data FROM settings").get();
    const preview = previewNoteHierarchyMigration(f.db);
    assert.equal(preview.status, "pending"); assert.deepEqual(rows(f.db), before);
    assert.equal(readdirSync(f.root).some(name => name.includes("backup")), false);
    const result = migrateNoteHierarchy(f.db, { databasePath: f.databasePath });
    assert.equal(result.status, "completed"); assert.equal(result.excludedLearnedFacts, 1);
    assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
    const backup = new DatabaseSync(result.backupPath, { readOnly: true });
    try { assert.deepEqual(rows(backup), before); } finally { backup.close(); }
    assert.equal(note(f.db, "legacy").id, "legacy"); assert.equal(note(f.db, "legacy").ownerId, "owner");
    assert.equal(note(f.db, "legacy").content, "\n  exact Markdown  \n"); assert.equal(note(f.db, "legacy").version, 7);
    assert.equal(note(f.db, "legacy").parentId, null); assert.equal(note(f.db, "legacy").sortKey, 0);
    assert.equal(note(f.db, "legacy").formatVersion, 1); assert.equal(note(f.db, "legacy").asset.id, "same-asset");
    assert.equal(note(f.db, "legacy").todos[0].id, "task"); assert.equal(note(f.db, "legacy").archived, true);
    assert.equal(note(f.db, "project").projectId, "existing"); assert.equal(note(f.db, "project").sortKey, 88);
    assert.equal(note(f.db, "ghost-root").projectId, null);
    assert.equal(note(f.db, "ghost-member").ownerId, "member"); assert.equal(note(f.db, "ghost-member").parentId, null);
    assert.equal(note(f.db, "ghost-grandchild").parentId, "ghost-member"); assert.equal(note(f.db, "ghost-grandchild").version, 8);
    assert.deepEqual(note(f.db, "fact"), fact);
    assert.deepEqual(f.db.prepare("SELECT data FROM chats").get(), chat); assert.deepEqual(f.db.prepare("SELECT data FROM settings").get(), settings);
    assert.deepEqual(readFileSync(f.attachmentPath), Buffer.from([0, 1, 2, 255]));
    const migrated = rows(f.db), backupNames = readdirSync(path.dirname(result.backupPath));
    assert.equal(migrateNoteHierarchy(f.db, { databasePath: f.databasePath }).status, "already-completed");
    assert.deepEqual(rows(f.db), migrated); assert.deepEqual(readdirSync(path.dirname(result.backupPath)), backupNames);
    assert.ok(noteHierarchyMigrationMarker(f.db));
  } finally { f.close(); }
});

test("migration CLI defaults to read-only preview and exposes apply and rollback", () => {
  const f = fixture();
  try {
    const script = fileURLToPath(new URL("../scripts/migrate-note-hierarchy.ts", import.meta.url));
    const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", script, "--database", f.databasePath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    const before = rows(f.db);
    assert.equal(run().status, "pending"); assert.deepEqual(rows(f.db), before);
    assert.equal(run("--apply").status, "completed");
    assert.equal(run("--dry-run").status, "already-completed");
    assert.equal(run("--rollback").status, "rolled-back");
    assert.deepEqual(rows(f.db), before);
  } finally { f.close(); }
});

test("guarded rollback restores exactly migrated rows while preserving new pages and unrelated writes", () => {
  const f = fixture();
  try {
    const before = rows(f.db);
    migrateNoteHierarchy(f.db, { databasePath: f.databasePath });
    f.add("new-page", "owner", { parentId: null, sortKey: 123, formatVersion: 1 });
    f.db.prepare("UPDATE chats SET data=? WHERE id='chat'").run('{"new":"chat write survives"}');
    const result = rollbackNoteHierarchyMigration(f.db);
    assert.equal(result.status, "rolled-back");
    assert.deepEqual(rows(f.db).filter(row => row.id !== "new-page"), before);
    assert.equal(note(f.db, "new-page").sortKey, 123);
    assert.equal((f.db.prepare("SELECT data FROM chats").get() as { data: string }).data, '{"new":"chat write survives"}');
    assert.equal(noteHierarchyMigrationMarker(f.db), null);
    assert.equal(rollbackNoteHierarchyMigration(f.db).status, "not-applied");
    assert.equal(migrateNoteHierarchy(f.db, { databasePath: f.databasePath }).status, "completed");
  } finally { f.close(); }
});

test("migration failures roll back their marker and rows; rollback refuses to overwrite subsequent edits", () => {
  const f = fixture();
  try {
    const before = rows(f.db);
    f.db.exec("CREATE TEMP TRIGGER reject_note_migration BEFORE UPDATE ON notes WHEN NEW.id='ghost-member' BEGIN SELECT RAISE(ABORT,'fixture migration failure'); END");
    assert.throws(() => migrateNoteHierarchy(f.db, { databasePath: f.databasePath }), /fixture migration failure/);
    assert.deepEqual(rows(f.db), before); assert.equal(noteHierarchyMigrationMarker(f.db), null);
    assert.equal(readdirSync(path.join(f.root, "note-hierarchy-backups")).length, 1);
    f.db.exec("DROP TRIGGER reject_note_migration");
    migrateNoteHierarchy(f.db, { databasePath: f.databasePath });
    const changed = note(f.db, "legacy"); changed.content = "new local edit"; changed.version++;
    f.db.prepare("UPDATE notes SET data=?,version=? WHERE id='legacy'").run(JSON.stringify(changed), changed.version);
    const afterEdit = rows(f.db);
    assert.throws(() => rollbackNoteHierarchyMigration(f.db), /Refusing to overwrite a note edited/);
    assert.deepEqual(rows(f.db), afterEdit); assert.ok(noteHierarchyMigrationMarker(f.db));
  } finally { f.close(); }
});
