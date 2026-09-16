import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-chat-sync-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;

const modulesPromise = Promise.all([
  import("../lib/auth"),
  import("../lib/db-store"),
  import("../lib/chat-sync"),
]);
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("chat sync events are owner-scoped, ordered, and survive chat deletion", async () => {
  const { createUser } = modules[0];
  const { appendMessage, createChat, deleteChat, upsertMessage } = modules[1];
  const { listChatSyncEvents, subscribeToDatabaseChanges } = modules[2];
  const owner = createUser("sync-owner", "secret");
  const other = createUser("sync-other", "secret");

  const chat = createChat("Live sync", undefined, owner.id);
  const created = listChatSyncEvents(owner.id);
  assert.equal(created.length, 1);
  assert.equal(created[0].chatId, chat.id);
  assert.equal(created[0].kind, "created");
  assert.deepEqual(listChatSyncEvents(other.id), []);

  let awakened = false;
  const wake = new Promise<void>((resolve) => {
    const unsubscribe = subscribeToDatabaseChanges(() => {
      awakened = true;
      unsubscribe();
      resolve();
    });
  });
  appendMessage(chat.id, { role: "user", content: "sent now" }, owner.id);
  await Promise.race([
    wake,
    new Promise((_, reject) => setTimeout(() => reject(new Error("sync watcher did not wake")), 1_000)),
  ]);
  assert.equal(awakened, true);

  const changed = listChatSyncEvents(owner.id, created[0].id);
  assert.equal(changed.at(-1)?.kind, "updated");
  const lastId = changed.at(-1)?.id || 0;
  const assistantId = randomUUID();
  upsertMessage(chat.id, { id: assistantId, role: "assistant", content: "live checkpoint" });
  const checkpointed = listChatSyncEvents(owner.id, lastId);
  assert.equal(checkpointed.at(-1)?.kind, "updated");
  assert.equal(checkpointed.at(-1)?.chatId, chat.id);
  const afterCheckpoint = checkpointed.at(-1)?.id || lastId;
  assert.equal(deleteChat(chat.id, owner.id), true);
  const deleted = listChatSyncEvents(owner.id, afterCheckpoint);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].kind, "deleted");
  assert.equal(deleted[0].chatId, chat.id);
});
