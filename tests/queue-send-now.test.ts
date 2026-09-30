import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { shouldStartQueuedFollowUp } from "../lib/composer-send";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-queue-send-now-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.MCP_BEARER_TOKEN = "queue-send-now-test-only";
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;
const loaded = Promise.all([
  import("../lib/db-store"), import("../lib/db-jobs"), import("../lib/sqlite"),
  import("../app/api/chat/route"), import("../lib/uploads"),
]);
let modules!: Awaited<typeof loaded>;
before(async () => { modules = await loaded; });
after(() => { rmSync(dataDir, { recursive: true, force: true }); });

function fixture(active = true) {
  const [store, jobs, sqlite] = modules;
  const ownerId = randomUUID();
  const token = randomUUID();
  const timestamp = new Date().toISOString();
  const db = sqlite.getDatabase();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(ownerId, "queue-send-" + ownerId, "unused-fixture", timestamp);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), ownerId, "2099-01-01T00:00:00.000Z");
  const chat = store.createChat("Send now test", undefined, ownerId);
  const first = { id: randomUUID(), text: "later", referenceText: "keep reference" };
  const selected = { id: randomUUID(), text: "send this now" };
  store.updateChat(chat.id, { queuedMessages: [first, selected] }, ownerId);
  const old = active ? jobs.enqueueJob({ chatId: chat.id, userId: ownerId, message: "old run" }) : null;
  if (old) jobs.updateJob(old.id, { status: "running" });
  const submit = (extra: Record<string, unknown> = {}, cookie: string = token) => modules[3].POST(
    new Request("http://localhost/api/chat", {
      method: "POST", headers: { cookie: "ai_chat_auth=" + cookie, "content-type": "application/json" },
      body: JSON.stringify({ chatId: chat.id, messageId: selected.id, message: selected.text, sendQueuedNow: true, ...extra }),
    }),
  );
  return { ownerId, chat, first, selected, old, submit };
}

test("Send now bypasses a running/paused runtime but retains submission locks", () => {
  const state = { busy: true, waitingForQuestion: true, hasActiveRuntime: true,
    drainInFlight: false, sendInFlight: false, interruptActiveRun: true };
  assert.equal(shouldStartQueuedFollowUp(state), true);
  assert.equal(shouldStartQueuedFollowUp({ ...state, drainInFlight: true }), false);
  assert.equal(shouldStartQueuedFollowUp({ ...state, sendInFlight: true }), false);
  assert.equal(shouldStartQueuedFollowUp({ ...state, interruptActiveRun: false }), false);
});

test("Send now atomically replaces a running job and consumes only the selected item", async () => {
  const f = fixture();
  assert.equal((await f.submit({ sendQueuedNow: false })).status, 409);
  const response = await f.submit();
  assert.equal(response.status, 202);
  const accepted = await response.json();
  assert.equal(modules[1].getJob(f.old!.id)?.status, "cancelled");
  assert.equal(modules[1].getActiveJob(f.chat.id, f.ownerId)?.id, accepted.jobId);
  const next = modules[0].getChat(f.chat.id, f.ownerId)!;
  assert.deepEqual(next.queuedMessages, [f.first]);
  assert.equal(next.messages.filter((item) => item.id === f.selected.id).length, 1);
  assert.equal(next.messages.at(-1)?.content, f.selected.text);
  assert.equal(modules[1].getJob(accepted.jobId)?.messageId, f.selected.id);
});

test("idle Send now accepts a selected follow-up exactly once", async () => {
  const f = fixture(false);
  const accepted = await (await f.submit()).json();
  const retry = await (await f.submit()).json();
  assert.equal(retry.jobId, accepted.jobId);
  assert.equal(modules[0].getChat(f.chat.id)?.messages.filter((m) => m.id === f.selected.id).length, 1);
  assert.deepEqual(modules[0].getChat(f.chat.id)?.queuedMessages, [f.first]);
});

test("a delayed retry of a completed follow-up cannot cancel a newer run", async () => {
  const f = fixture(false);
  const accepted = await (await f.submit()).json();
  modules[1].updateJob(accepted.jobId, { status: "completed" });
  const newer = modules[1].enqueueJob({ chatId: f.chat.id, userId: f.ownerId, message: "newer run" });
  modules[1].updateJob(newer.id, { status: "running" });
  const retry = await f.submit();
  assert.equal(retry.status, 202);
  assert.equal((await retry.json()).jobId, accepted.jobId);
  assert.equal(modules[1].getJob(newer.id)?.status, "running");
});

test("rejected payloads roll back cancellation and leave the queue intact", async () => {
  const f = fixture();
  const response = await f.submit({ attachments: Array.from({ length: 11 }, () => ({ name: "bad", mimeType: "text/plain", data: "YQ==" })) });
  assert.equal(response.status, 400);
  assert.equal(modules[1].getJob(f.old!.id)?.status, "running");
  modules[0].clearStoreCaches();
  assert.deepEqual(modules[0].getChat(f.chat.id)?.queuedMessages, [f.first, f.selected]);
  assert.equal(modules[0].getChat(f.chat.id)?.messages.length, 0);
});

test("Send now rejects removed items and missing IDs without interrupting the run", async () => {
  const f = fixture();
  modules[0].removeQueuedMessage(f.chat.id, f.selected.id, f.ownerId);
  assert.equal((await f.submit()).status, 409);
  assert.equal((await f.submit({ messageId: undefined })).status, 400);
  assert.equal(modules[1].getJob(f.old!.id)?.status, "running");
});

test("another owner cannot use Send now to cancel or submit to this chat", async () => {
  const f = fixture();
  const other = fixture(false);
  assert.equal((await f.submit({}, "invalid-token")).status, 401);
  const db = modules[2].getDatabase();
  const otherToken = randomUUID();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(otherToken).digest("hex"), other.ownerId, "2099-01-01T00:00:00.000Z");
  assert.equal((await f.submit({}, otherToken)).status, 404);
  assert.equal(modules[1].getJob(f.old!.id)?.status, "running");
});

test("a queued stored attachment with no text can be sent", async () => {
  const f = fixture(false);
  const stored = modules[4].saveAttachments(f.chat.id, [{
    name: "queue.txt", mimeType: "text/plain", data: Buffer.from("queued file").toString("base64"),
  }], f.ownerId).stored;
  const response = await f.submit({ message: "", storedAttachments: stored });
  assert.equal(response.status, 202);
  const accepted = await response.json();
  assert.deepEqual(modules[1].getJob(accepted.jobId)?.attachments, stored);
  assert.deepEqual(modules[0].getChat(f.chat.id)?.messages.at(-1)?.attachments, stored);
});

test("Send now cancels a pending question before accepting the follow-up", async () => {
  const f = fixture();
  const questions = await import("../lib/db-questions");
  const pending = questions.createPendingQuestion([{ question: "Old question" }], f.chat.id, f.ownerId, {
    jobId: f.old!.id, runId: f.old!.id,
  });
  modules[1].updateJob(f.old!.id, { status: "waiting_input" });
  modules[0].updateChat(f.chat.id, { pendingQuestion: pending, runStatus: "waiting_input" }, f.ownerId);
  assert.equal((await f.submit()).status, 202);
  assert.equal(modules[1].getJob(f.old!.id)?.status, "cancelled");
  assert.equal(modules[0].getChat(f.chat.id)?.pendingQuestion, undefined);
});
