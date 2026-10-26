import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Set isolation before importing any module which captures config. The loader
// starts the real chat-page-worker.mjs with its production 192 MiB heap limit.
const root = mkdtempSync(path.join(os.tmpdir(), "metis-metadata-persistence-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AI_CHAT_ROOT: root, AGENT_CWD: root,
  AI_CHAT_INSTALL_DIR: path.resolve(import.meta.dirname, ".."),
});
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;

test("real metadata PATCH worker persists large-chat model and queue without hydrating history", { timeout: 120_000 }, async t => {
  const [{ getDatabase }, store, { PATCH }] = await Promise.all([
    import("../lib/sqlite"), import("../lib/db-store"),
    import("../app/api/chats/[id]/route"),
  ]);
  const db = getDatabase();
  t.after(async () => {
    // The loader terminates its idle worker after one second; let it close its
    // connection before deleting the isolated database (including on rejection).
    await new Promise(resolve => setTimeout(resolve, 1500));
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const owner = randomUUID(), token = randomUUID(), stamp = new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)")
    .run(owner, owner, "unused", stamp);
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .run(createHash("sha256").update(token).digest("hex"), owner, "2099-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO user_model_permissions(user_id,model_id,created_at) VALUES(?,?,?)")
    .run(owner, "*", stamp);
  const chat = store.createChat("Synthetic large metadata fixture", undefined, owner);

  // ~144 MiB stress fixture (2x the largest observed chat). All large
  // construction and snapshots stay in SQLite, never a full JS string/object.
  // Consumed IDs at both ends catch implementations checking only a tail page.
  db.prepare(`
    WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n<143),
    payload AS (SELECT replace(hex(zeroblob(524288)), '0', 'x') AS text)
    UPDATE chats SET data=json_set(data,'$.messages',json((
      SELECT json_group_array(json_object(
        'id', CASE n WHEN 0 THEN 'consumed-first' WHEN 143 THEN 'consumed-last' ELSE 'history-'||n END,
        'role', CASE WHEN n IN (0,143) THEN 'user' ELSE 'assistant' END,
        'content',payload.text,'createdAt',?
      )) FROM seq CROSS JOIN payload
    ))) WHERE id=?
  `).run(stamp, chat.id);
  db.exec("CREATE TEMP TABLE original_messages (messages TEXT NOT NULL)");
  db.prepare("INSERT INTO original_messages SELECT json_extract(data,'$.messages') FROM chats WHERE id=?").run(chat.id);
  const bytes = Number(db.prepare("SELECT length(CAST(data AS BLOB)) AS bytes FROM chats WHERE id=?").get(chat.id)!.bytes);
  assert.ok(bytes > 144 * 1024 * 1024);
  t.diagnostic("Synthetic canonical fixture bytes: " + bytes);

  // Durable explicit-delete tombstone: a delayed browser echo must not restore it.
  db.prepare("INSERT INTO queue_message_removals(chat_id,message_id) VALUES(?,?)").run(chat.id, "removed");
  const params = { params: Promise.resolve({ id: chat.id }) };
  const persisted = () => JSON.parse(String(db.prepare(
    "SELECT json_remove(data,'$.messages') AS metadata FROM chats WHERE id=?",
  ).get(chat.id)!.metadata));
  const unchanged = () => assert.equal(db.prepare(`
    SELECT json_extract(data,'$.messages') = (SELECT messages FROM original_messages) AS unchanged
    FROM chats WHERE id=?
  `).get(chat.id)!.unchanged, 1, "canonical messages must remain byte-for-byte unchanged");
  const patch = async (body: Record<string, unknown>) => {
    const response = await PATCH(new Request("http://fixture/api/chats/" + chat.id, {
      method: "PATCH", headers: { cookie: "ai_chat_auth=" + token, "content-type": "application/json" },
      body: JSON.stringify(body),
    }), params);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(Buffer.byteLength(text) < 16 * 1024, "metadata response must remain bounded");
    const result = JSON.parse(text);
    assert.deepEqual(result.chat.messages, []);
    unchanged();
    return result.chat;
  };

  await t.test("model PATCH persists to canonical DB and returns bounded metadata", async () => {
    // Synthetic ID tests persistence, not provider discovery or network access.
    const modelId = "cursor:metadata-regression-fixture";
    const result = await patch({ modelId });
    assert.equal(result.modelId, modelId);
    assert.equal(persisted().modelId, modelId);
  });

  await t.test("queue PATCH preserves edits/order and rejects consumed and removed IDs", async () => {
    const first = { id: "pending-first", text: "First follow-up" };
    const second = { id: "pending-second", text: "Second follow-up" };
    const stale = ["consumed-first", "consumed-last", "removed"].map(id => ({ id, text: "Stale echo" }));
    await patch({ queuedMessages: [...stale, first, second] });
    assert.deepEqual(persisted().queuedMessages, [first, second]);
    const edited = { ...second, text: "Edited second", referenceText: "Reference retained" };
    const result = await patch({ queuedMessages: [edited, first, ...stale] });
    assert.deepEqual(result.queuedMessages, [edited, first]);
    assert.deepEqual(persisted().queuedMessages, [edited, first]);
    await patch({ queuedMessages: [] });
    assert.deepEqual(persisted().queuedMessages, [edited, first], "stale empty snapshot cannot delete pending items");
    assert.deepEqual(persisted().removedQueuedMessageIds, ["removed"]);
    unchanged();
  });
});
