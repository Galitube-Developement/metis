import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-observer-thread-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "test.sqlite"),
  AGENT_CWD: root, CHAT_PASSWORD: "", METIS_AI_BOOTSTRAP_PASSWORD: "",
});
async function until(predicate: () => boolean, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "condition timed out");
    await delay(20);
  }
}

test("worker preserves observation, replay, delivery ACK and keeps parent timers responsive under writer lock", async () => {
  const store = await import("../lib/notification-store");
  const { getDatabase } = await import("../lib/sqlite");
  const { startNotificationObserver } = await import("../lib/notification-observer-thread");
  const db = getDatabase();
  store.notificationDatabase();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES ('alice','alice','test',?)").run(now);
  db.prepare("INSERT INTO chats(id,owner_id,data,created_at,updated_at) VALUES ('chat','alice',?,?,?)")
    .run(JSON.stringify({id:"chat",ownerId:"alice"}),now,now);
  db.prepare("INSERT INTO jobs(id,chat_id,user_id,data,status,updated_at) VALUES ('job','chat','alice','{}','running',?)").run(now);
  db.prepare("INSERT INTO remote_clients(id,owner_id,name,created_at,updated_at) VALUES ('pc','alice','Test',?,?)").run(now,now);
  let ready = 0;
  let sends = 0;
  const errors: string[] = [];
  const options = {
    intervalMs: 30,
    stopTimeoutMs: 150,
    onReady: () => { ready++; },
    onError: (message: string) => { errors.push(message); console.error(message); },
    send: async (clientId: string, ownerId: string, notification: {title:string}) => {
      assert.equal(clientId,"pc");
      assert.equal(ownerId,"alice");
      assert.equal(notification.title,"Run completed");
      sends++;
      return true;
    },
  };
  let stop = startNotificationObserver(options);
  const lock = new DatabaseSync(process.env.CHAT_DB_PATH!);
  try {
    await until(() => ready === 1);
    db.prepare("INSERT INTO run_events(job_id,chat_id,user_id,event,data,created_at) VALUES ('job','chat','alice','done','{}',?)").run(now);
    await until(() => sends === 1);
    await until(() => Number((db.prepare("SELECT count(*) AS n FROM notification_deliveries WHERE acknowledged_at IS NOT NULL").get() as {n:number}).n) === 1);
    await stop();
    // Durable replay after a worker restart must not duplicate records or sends.
    db.prepare("UPDATE notification_observer SET cursor=0").run();
    stop = startNotificationObserver(options);
    await until(() => ready === 2);
    await delay(200);
    assert.equal(sends,1);
    assert.equal(store.getNotificationFeed("alice",0).notifications.length,1);
    // Muted delivery remains muted when processed in the worker.
    store.setNotificationPrefs("alice",{remoteEnabled:false});
    store.createNotification("alice",{title:"muted"});
    await delay(100);
    assert.equal(sends,1);
    lock.exec("BEGIN IMMEDIATE");
    let ticks = 0;
    const heartbeat = setInterval(() => { ticks++; }, 10);
    const began = Date.now();
    await delay(350);
    clearInterval(heartbeat);
    assert.ok(ticks >= 15, `parent timer stalled: ${ticks} ticks`);
    assert.ok(Date.now()-began < 1500, "parent event loop blocked on SQLite");
    const stopBegan = Date.now();
    await stop();
    assert.ok(Date.now()-stopBegan < 1500, "stop must terminate a worker blocked on SQLite");
    lock.exec("ROLLBACK");
    await stop(); // Idempotent cleanup.
    assert.ok(errors.every(message => /locked|busy/i.test(message)), errors.join("\n"));
  } finally {
    try { lock.exec("ROLLBACK"); } catch {}
    lock.close();
    await stop();
    db.close();
    rmSync(root,{recursive:true,force:true});
  }
});
