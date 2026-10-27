import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { createServer } from "node:http";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-submit-worker-"));
Object.assign(process.env, {
  CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AI_CHAT_ROOT: root, AGENT_CWD: root,
  AI_CHAT_INSTALL_DIR: path.resolve(import.meta.dirname, ".."),
});
delete process.env.AI_CHAT_JOB_ID;
delete process.env.AI_CHAT_WORKER_ID;
delete process.env.AI_CHAT_JOB_LEASE_TOKEN;

test("HTTP submission stays responsive under write lock, preserves 202/idempotency and owner isolation", { timeout: 30000 }, async t => {
  const [{ getDatabase }, store, jobs, { POST }] = await Promise.all([
    import("../lib/sqlite"), import("../lib/db-store"), import("../lib/db-jobs"),
    import("../app/api/chat/route"),
  ]);
  const db = getDatabase();
  const account = () => {
    const owner = randomUUID(), token = randomUUID();
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)")
      .run(owner, owner, "unused", new Date().toISOString());
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(createHash("sha256").update(token).digest("hex"), owner, "2099-01-01T00:00:00.000Z");
    return { owner, token };
  };
  const a = account(), b = account();
  const chat = store.createChat("Lock fixture", undefined, a.owner);
  const messageId = randomUUID();
  const expired=store.createChat("Expired fixture",undefined,a.owner,undefined,{incognito:true});
  db.prepare("UPDATE chat_list SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z",expired.id);
  const server = createServer(async (req, res) => {
    if (req.url === "/ping") { res.end("pong"); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const response = await POST(new Request("http://fixture/api/chat", {
      method: "POST", headers: { cookie: String(req.headers.cookie || "") },
      body: Buffer.concat(chunks).toString(),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = "http://127.0.0.1:" + address.port;
  const submit = (token: string = a.token, id: string = messageId) => fetch(base + "/api/chat", {
    method: "POST", headers: { cookie: "ai_chat_auth=" + token },
    body: JSON.stringify({ chatId: chat.id, message: "synthetic message", messageId: id }),
  });
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise(resolve => setTimeout(resolve, 1500));
    db.close(); rmSync(root, { recursive: true, force: true });
  });
  // Warm the real worker and its SQLite connection before acquiring the lock.
  assert.equal((await submit(b.token)).status, 404);
  assert.equal((await submit("invalid")).status, 401);
  // Server bootstrap establishes the durable cursor before accepting requests.
  db.prepare("INSERT OR IGNORE INTO notification_observer(key,cursor) VALUES ('runs',0)").run();
  const locker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(workerData);
    db.exec("BEGIN IMMEDIATE"); parentPort.postMessage("locked");
    parentPort.once("message", () => { db.exec("COMMIT"); db.close(); parentPort.postMessage("unlocked"); });
  `, { eval: true, workerData: process.env.CHAT_DB_PATH });
  t.after(() => locker.terminate());
  await new Promise<void>((resolve, reject) => {
    locker.once("message", () => resolve()); locker.once("error", reject);
  });
  // Read-only UI polling must not attempt schema/cursor/cleanup writes either.
  const notifications=await import("../lib/notification-store");
  assert.equal(notifications.getNotificationFeed(a.owner,0).notifications.length,0);
  assert.equal(store.listChatsForUser(a.owner).length,1);
  let ticks = 0, settled = false;
  const timer = setInterval(() => ticks++, 10);
  const pending = submit().then(response => { settled = true; return response; });
  const queued: Promise<unknown>[] = [];
  try {
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(settled, false, "submission must wait for the SQLite writer");
    assert.ok(ticks >= 10, "main-thread timer must remain responsive");
    assert.equal(await (await fetch(base + "/ping")).text(), "pong");
    const { submitChatOffThread } = await import("../lib/chat-page-loader");
    for (let i = 0; i < 15; i++) queued.push(submitChatOffThread({
      url: "http://fixture/api/chat", headers: [["cookie", "ai_chat_auth=" + a.token]],
      body: JSON.stringify({ chatId: chat.id, message: "synthetic message", messageId }),
    }));
    const overflow = await submit();
    assert.equal(overflow.status, 503);
    assert.equal(overflow.headers.get("retry-after"), "1");
  } finally {
    clearInterval(timer); locker.postMessage("unlock");
  }
  const accepted = await pending;
  assert.equal(store.cleanupExpiredIncognitoChats(),1);
  const queuedResponses = await Promise.all(queued) as { status: number }[];
  assert.ok(queuedResponses.every(response => response.status === 202));
  assert.equal(accepted.status, 202);
  const result = await accepted.json();
  assert.equal(jobs.getJob(result.jobId)?.messageId, messageId);
  assert.equal(jobs.getJob(result.jobId)?.status, "queued");
  assert.equal((await (await submit()).json()).jobId, result.jobId);
  assert.equal((await submit(b.token, randomUUID())).status, 404);
  store.clearStoreCaches();
  assert.equal(store.getChat(chat.id, a.owner)?.messages.filter(m => m.id === messageId).length, 1);
  assert.equal(store.getChat(chat.id, b.owner), null);
});
