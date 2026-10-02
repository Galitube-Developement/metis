import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { mergeQueuedFollowUps } from "../lib/composer-send";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-queue-removal-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.MCP_BEARER_TOKEN = "queue-removal-test-only";
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;

const loaded = Promise.all([import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/sqlite")]);
let modules!: Awaited<typeof loaded>;
before(async () => { modules = await loaded; });
after(() => { rmSync(dataDir, { recursive: true, force: true }); });

test("deleted follow-ups stay deleted after a delayed queue autosave", () => {
  const [store] = modules;
  const chat = store.createChat("Delete race");
  const queue = [{ id: randomUUID(), text: "remove me" }, { id: randomUUID(), text: "keep me" }];
  store.updateChat(chat.id, { queuedMessages: queue });
  store.removeQueuedMessage(chat.id, queue[0].id);
  // A pre-click PATCH can arrive after the explicit deletion.
  const saved = store.updateChat(chat.id, { queuedMessages: queue });
  assert.deepEqual(saved?.queuedMessages, [queue[1]]);
  store.clearStoreCaches();
  assert.deepEqual(store.getChat(chat.id)?.queuedMessages, [queue[1]]);
});

test("a deletion arriving before the initial queue save cannot be undone", () => {
  const [store, jobs] = modules;
  const chat = store.createChat("Delete before save");
  const item = { id: randomUUID(), text: "never run this" };
  store.removeQueuedMessage(chat.id, item.id);
  store.updateChat(chat.id, { queuedMessages: [item] });
  assert.equal(store.getChat(chat.id)?.queuedMessages, undefined);
  assert.equal(jobs.drainNextQueuedMessage(chat.id), null);
});

test("late full chat projections cannot resurrect a removed queue item", () => {
  const [store] = modules;
  const chat = store.createChat("Stale projection");
  const item = { id: randomUUID(), text: "remove me" };
  const stale = store.updateChat(chat.id, { queuedMessages: [item] })!;
  store.removeQueuedMessage(chat.id, item.id);
  store.saveChat(stale);
  assert.equal(store.getChat(chat.id)?.queuedMessages, undefined);
});

test("queue removals are scoped to the chat and cleaned up with it", () => {
  const [store, , sqlite] = modules;
  const first = store.createChat("First");
  const second = store.createChat("Second");
  const item = { id: randomUUID(), text: "same ID in another chat" };
  store.updateChat(first.id, { queuedMessages: [item] });
  store.updateChat(second.id, { queuedMessages: [item] });
  store.removeQueuedMessage(first.id, item.id);
  assert.deepEqual(store.getChat(second.id)?.queuedMessages, [item]);
  store.deleteChat(first.id);
  assert.equal(sqlite.getDatabase().prepare(
    "SELECT COUNT(*) AS count FROM queue_message_removals WHERE chat_id = ?",
  ).get(first.id)?.count, 0);
});

function sessionFixture() {
  const database = modules[2].getDatabase();
  const ownerId = randomUUID();
  const token = randomUUID();
  database.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(ownerId, "queue-" + ownerId, "fixture-unused", new Date().toISOString());
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), ownerId, "2099-01-01T00:00:00.000Z");
  const chat = modules[0].createChat("Owner queue", undefined, ownerId);
  return { ownerId, token, chat };
}

test("queue DELETE requires authentication and isolates owners", async () => {
  const { DELETE } = await import("../app/api/chats/[id]/queue/[messageId]/route");
  const f = sessionFixture();
  const other = sessionFixture();
  const item = { id: randomUUID(), text: "private follow-up" };
  modules[0].updateChat(f.chat.id, { queuedMessages: [item] }, f.ownerId);
  const params = { params: Promise.resolve({ id: f.chat.id, messageId: item.id }) };
  const url = "http://localhost/api/chats/" + f.chat.id + "/queue/" + item.id;
  assert.equal((await DELETE(new Request(url), params)).status, 401);
  assert.equal((await DELETE(new Request(url, { headers: { cookie: "ai_chat_auth=" + other.token } }), params)).status, 404);
  assert.deepEqual(modules[0].getChat(f.chat.id, f.ownerId)?.queuedMessages, [item]);
  const request = () => new Request(url, { headers: { cookie: "ai_chat_auth=" + f.token } });
  assert.equal((await DELETE(request(), params)).status, 200);
  assert.equal((await DELETE(request(), params)).status, 200);
  assert.equal(modules[0].getChat(f.chat.id, f.ownerId)?.queuedMessages, undefined);
});

test("real queue DELETE followed by stale chat PATCH cannot revive the item", async () => {
  const { DELETE } = await import("../app/api/chats/[id]/queue/[messageId]/route");
  const { PATCH, GET } = await import("../app/api/chats/[id]/route");
  const f = sessionFixture();
  const headers = { cookie: "ai_chat_auth=" + f.token, "content-type": "application/json" };
  const item = { id: randomUUID(), text: "delete me" };
  const kept = { id: randomUUID(), text: "still queued" };
  modules[0].updateChat(f.chat.id, { queuedMessages: [item, kept] }, f.ownerId);
  const url = "http://localhost/api/chats/" + f.chat.id;
  assert.equal((await DELETE(new Request(url + "/queue/" + item.id, { headers }), {
    params: Promise.resolve({ id: f.chat.id, messageId: item.id }),
  })).status, 200);
  const response = await PATCH(new Request(url, {
    method: "PATCH", headers, body: JSON.stringify({ queuedMessages: [item, kept] }),
  }), { params: Promise.resolve({ id: f.chat.id }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).chat.queuedMessages, [kept]);
  const reloaded = await GET(new Request(url, { headers }), { params: Promise.resolve({ id: f.chat.id }) });
  const reloadedChat = (await reloaded.json()).chat;
  assert.deepEqual(reloadedChat.queuedMessages, [kept]);
  assert.deepEqual(reloadedChat.removedQueuedMessageIds, [item.id]);
  // A cached queue loaded after a page refresh must honor durable server removals.
  assert.deepEqual(mergeQueuedFollowUps([item, kept], reloadedChat.queuedMessages, {
    removedIds: reloadedChat.removedQueuedMessageIds,
  }), [kept]);
});
