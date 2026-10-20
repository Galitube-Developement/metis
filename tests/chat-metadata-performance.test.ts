import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(path.join(tmpdir(), "metis-metadata-performance-"));
Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_ROOT: root, AGENT_CWD: root });
const modules = Promise.all([import("../lib/sqlite"), import("../lib/db-store"), import("../lib/auth"), import("../lib/project-access"), import("../lib/projects"), import("../lib/project-sharing"), import("../lib/context")]);
test.after(async () => { (await modules)[0].getDatabase().close(); rmSync(root, { recursive: true, force: true }); });

test("chat metadata avoids transcript reads while preserving pin and access semantics", async t => {
  const [sqlite, store, auth, access, projects, sharing, context] = await modules;
  const db = sqlite.getDatabase();
  const owner = auth.createUser("metadata-owner", "test-password").id;
  const member = auth.createUser("metadata-member", "test-password").id;
  const stranger = auth.createUser("metadata-stranger", "test-password").id;
  const project = projects.createProject({ ownerId: owner });
  const chat = store.createChat("Large history", undefined, owner, undefined, { projectId: project.id });
  store.appendMessage(chat.id, { role: "user", content: "history ".repeat(250_000) }, owner);
  store.updateChat(chat.id, { sessionState: { pinnedNoteIds: ["owner-note"], unpinnedGlobalNoteIds: ["muted-note"] } }, owner);
  store.saveGlobalModelSettings({ pinnedNoteIds: ["global-note", "muted-note"] }, owner);
  const invite = sharing.inviteProjectMember(project.id, owner, "metadata-member");
  sharing.respondProjectInvitation(invite.id, member, "accept");

  await t.test("personal pins stay separate in shared projects and update on writes", () => {
    assert.deepEqual(store.getChatNotePins(chat.id, owner), { pinnedNoteIds: ["owner-note"], unpinnedGlobalNoteIds: ["muted-note"] });
    assert.deepEqual(store.getChatNotePins(chat.id, member), { pinnedNoteIds: [], unpinnedGlobalNoteIds: [] });
    store.updateChat(chat.id, { sessionState: { pinnedNoteIds: ["member-note"] } }, member);
    assert.deepEqual(store.getChatNotePins(chat.id, member)?.pinnedNoteIds, ["member-note"]);
    assert.deepEqual(context.getPinnedNoteIds(owner, chat.id), ["global-note", "owner-note"]);
    assert.equal(store.getChatNotePins(chat.id, stranger), null);
  });

  await t.test("sidebar, access checks and pin GET never select transcript data", async () => {
    const token = auth.authenticateUser("metadata-owner", "test-password")!.token;
    const { GET } = await import("../app/api/context/pins/route");
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      // Check actual executed queries, rather than elapsed time or source wording.
      assert.doesNotMatch(sql, /SELECT[\s\S]*?\bFROM\s+chats\b/i, "metadata reads must not hydrate transcript rows");
      return prepare(sql);
    }) as typeof db.prepare;
    try {
      assert.ok(access.canAccessChat(chat.id, owner));
      assert.ok(access.canAccessChat(chat.id, member));
      assert.equal(access.canAccessChat(chat.id, stranger), false);
      assert.ok(store.listChatsForUser(owner).some(c => c.id === chat.id));
      assert.deepEqual(context.getPinnedNoteIds(owner, chat.id), ["global-note", "owner-note"]);
      const response = await GET(new Request("http://fixture/api/context/pins?chatId=" + chat.id + "&noteId=owner-note", { headers: { cookie: auth.CHAT_COOKIE + "=" + token } }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.chatNoteIds, ["owner-note"]);
      assert.deepEqual(body.configuredNoteIds, ["owner-note"]);
      assert.deepEqual(body.configuredChatIds, [chat.id]);
    } finally { db.prepare = prepare; }
  });

  await t.test("revocation is immediate even after the sidebar cache has warmed", () => {
    assert.ok(store.listChatsForUser(member).some(c => c.id === chat.id));
    sharing.removeProjectMember(project.id, owner, { userId: member });
    assert.equal(access.canAccessChat(chat.id, member), false);
    assert.equal(store.getChatNotePins(chat.id, member), null);
    assert.ok(!store.listChatsForUser(member).some(c => c.id === chat.id));
  });

  await t.test("legacy NULL pins and missing access projections preserve existing behavior", () => {
    db.prepare("UPDATE chat_list SET note_pins=NULL WHERE id=?").run(chat.id);
    assert.deepEqual(store.getChatNotePins(chat.id, owner)?.pinnedNoteIds, ["owner-note"]);
    const legacy = store.createChat("Imported", undefined, owner);
    db.prepare("DELETE FROM chat_list WHERE id=?").run(legacy.id);
    assert.ok(access.canAccessChat(legacy.id, owner));
    assert.equal(access.canAccessChat(legacy.id, stranger), false);
  });

  await t.test("legacy projection backfill is repeatable and leaves transcripts unchanged", () => {
    const before = db.prepare("SELECT data,updated_at FROM chats WHERE id=?").get(chat.id);
    db.exec("ALTER TABLE chat_list DROP COLUMN note_pins");
    const startup = () => {
      const result = spawnSync(process.execPath, ["--import", "tsx", "-e", "require('./lib/sqlite.ts').getDatabase().close()"], {
        cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 30_000,
        env: { NODE_ENV: "test", PATH: process.env.PATH, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"), AI_CHAT_ROOT: root, AGENT_CWD: root },
      });
      assert.equal(result.status, 0, result.stderr);
    };
    startup();
    assert.deepEqual(store.getChatNotePins(chat.id, owner)?.pinnedNoteIds, ["owner-note"]);
    assert.deepEqual(db.prepare("SELECT data,updated_at FROM chats WHERE id=?").get(chat.id), before);
    // A non-NULL projection is not rewritten on every new process.
    db.prepare("UPDATE chat_list SET note_pins='{}' WHERE id=?").run(chat.id);
    startup();
    assert.equal(db.prepare("SELECT note_pins FROM chat_list WHERE id=?").get(chat.id)!.note_pins, "{}");
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  });
});
