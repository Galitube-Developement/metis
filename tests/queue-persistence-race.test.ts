import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-queue-persist-race-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
after(() => rmSync(dataDir, { recursive: true, force: true }));

test("browser queue snapshots retain explicit reordering and field edits", async () => {
  const store = await import("../lib/db-store");
  const { updateChatOffThread } = await import("../lib/chat-page-loader");
  const chat = store.createChat("Queue order");
  const first = { id: randomUUID(), text: "first" };
  const second = { id: randomUUID(), text: "second" };
  const save = (queuedMessages: typeof first[]) => updateChatOffThread(chat.id, "", { queuedMessages, touchUpdatedAt: false });
  await save([first, second]);
  await save([{ ...second, text: "updated second" }, first]);
  store.clearStoreCaches();
  assert.deepEqual(store.getChat(chat.id)?.queuedMessages, [{ ...second, text: "updated second" }, first]);
});

test("delayed empty and partial autosaves cannot lose a busy chat's queued follow-ups", async () => {
  const store = await import("../lib/db-store");
  const jobs = await import("../lib/db-jobs");
  const { updateChatOffThread } = await import("../lib/chat-page-loader");
  const chat = store.createChat("Queue persistence race");
  const active = jobs.enqueueJob({ chatId: chat.id, message: "running fixture" });
  jobs.updateJob(active.id, { status: "running" });
  const first = { id: randomUUID(), text: "first follow-up" };
  const second = { id: randomUUID(), text: "second follow-up" };
  const save = (queuedMessages: typeof first[]) => updateChatOffThread(chat.id, "", { queuedMessages, touchUpdatedAt: false });
  await save([first]);
  await save([first, second]);
  // Requests captured before enqueue can finish after the current queue save.
  await save([]);
  await save([first]);
  store.clearStoreCaches(); // Returning to a chat must read durable state.
  assert.deepEqual(store.getChat(chat.id)?.queuedMessages, [first, second]);
  assert.throws(() => jobs.drainNextQueuedMessage(chat.id), { name: "ActiveChatRun" });
  jobs.updateJob(active.id, { status: "completed" });
  const dispatched = jobs.drainNextQueuedMessage(chat.id);
  assert.equal(dispatched?.messageId, first.id);
  await save([first, second]); // A delayed echo must not resurrect the dispatched item.
  store.clearStoreCaches();
  assert.deepEqual(store.getChat(chat.id)?.queuedMessages, [second]);
  store.removeQueuedMessage(chat.id, second.id);
  await save([first, second]);
  assert.equal(store.getChat(chat.id)?.queuedMessages, undefined);
});
