import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BoundedSnapshotCache } from "../lib/snapshot-cache";

test("snapshot caches enforce byte and entry budgets, including replacement and deletion", () => {
  const cache = new BoundedSnapshotCache<string, unknown>(() => [], 3, 1024);
  for (let i = 0; i < 20; i++) cache.set(String(i), { text: "x".repeat(160) });
  assert.ok(cache.size <= 3);
  assert.equal(cache.has("0"), false);
  assert.ok(cache.has("19"));
  cache.set("19", { text: "x".repeat(2000) });
  assert.equal(cache.has("19"), false);
  cache.clear();
  cache.set("small", "valid");
  assert.equal(cache.get("small"), "valid");
  assert.equal(cache.delete("small"), true);
  assert.equal(cache.size, 0);
});

test("cache reads survive eviction and leave complete durable histories unchanged", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "metis-server-chat-cache-"));
  Object.assign(process.env, { CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "fixture.sqlite"), AI_CHAT_ROOT: root, AGENT_CWD: root });
  const [store, { getDatabase }] = await Promise.all([import("../lib/db-store"), import("../lib/sqlite")]);
  const db = getDatabase();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 24; i++) {
      const chat = store.createChat("History " + i);
      store.appendMessage(chat.id, { role: "user", content: String(i) + ":" + "history".repeat(1000) });
      ids.push(chat.id);
    }
    const prepare = db.prepare.bind(db);
    let transcriptReads = 0;
    db.prepare = ((sql: string) => {
      if (/SELECT data FROM chats WHERE id/.test(sql)) transcriptReads++;
      return prepare(sql);
    }) as typeof db.prepare;
    try {
      assert.equal(store.getChat(ids[23])?.messages[0].content.slice(0, 3), "23:");
      assert.equal(transcriptReads, 0, "newest entry stays cached");
      assert.equal(store.getChat(ids[0])?.messages[0].content.slice(0, 2), "0:");
      assert.equal(transcriptReads, 1, "evicted entry is reloaded");
    } finally { db.prepare = prepare; }
    store.clearStoreCaches();
    for (let i = 0; i < ids.length; i++) {
      assert.equal(store.getChat(ids[i])?.messages[0].content, String(i) + ":" + "history".repeat(1000));
    }
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
