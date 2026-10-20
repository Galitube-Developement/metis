import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-remote-notification-defaults-"));
Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "test.sqlite"), AI_CHAT_ROOT: dir, AGENT_CWD: dir });
after(() => rmSync(dir, { recursive: true, force: true }));

test("remote notification defaults, enrollment and explicit mutes stay account scoped", async () => {
  const { getDatabase } = await import("../lib/sqlite");
  const store = await import("../lib/notification-store");
  const clients = await import("../lib/remote-clients");
  const route = await import("../app/api/remote-clients/enroll/route");
  const db = getDatabase(), now = new Date().toISOString();
  for (const owner of ["fresh", "muted", "foreign"]) {
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(owner,owner,"unused",now);
    db.prepare("INSERT INTO remote_clients(id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").run(owner+"-pc",owner,"PC",now,now);
  }
  db.prepare("INSERT INTO remote_clients(id,owner_id,name,created_at,updated_at,revoked_at) VALUES (?,?,?,?,?,?)").run("revoked","fresh","Revoked",now,now,now);
  assert.equal(store.getNotificationPrefs("fresh").remoteEnabled, true);
  assert.deepEqual(store.getNotificationPrefs("fresh").remoteClientIds, ["fresh-pc"]);
  const notice = store.createNotification("fresh", { title: "Default delivery" });
  assert.equal(store.notificationDeliverySummary("fresh",notice.id).queuedDevices,1);
  assert.deepEqual(db.prepare("SELECT client_id FROM notification_deliveries WHERE notification_id=?").all(notice.id).map(row=>row.client_id), ["fresh-pc"]);

  // Saving unrelated preferences must preserve defaults. Explicit empty lists stay empty.
  store.setNotificationPrefs("fresh", {toastEnabled:false});
  store.setNotificationPrefs("muted", {remoteEnabled:false,remoteClientIds:[]});
  const enroll = async (owner: string) => {
    const {token} = clients.createEnrollmentToken(owner);
    const response = await route.POST(new Request("http://test.invalid/api/remote-clients/enroll", {
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,name:"New PC"}),
    }));
    assert.equal(response.status,201);
    const body = await response.json();
    assert.equal((await route.POST(new Request("http://test.invalid/api/remote-clients/enroll", {
      method:"POST",body:JSON.stringify({token}),
    }))).status,401);
    return body.client.id as string;
  };
  const freshId = await enroll("fresh");
  assert.deepEqual(store.getNotificationPrefs("fresh").remoteClientIds, ["fresh-pc",freshId]);
  const mutedId = await enroll("muted");
  assert.equal(store.getNotificationPrefs("muted").remoteEnabled,false);
  assert.deepEqual(store.getNotificationPrefs("muted").remoteClientIds,[mutedId]);
  assert.equal(store.notificationDeliverySummary("muted",store.createNotification("muted",{title:"Muted"}).id).status,"disabled");
  store.setNotificationPrefs("fresh",{remoteClient:{id:freshId,enabled:false}});
  store.setNotificationPrefs("fresh",{agentFinishedEnabled:false});
  assert.deepEqual(store.getNotificationPrefs("fresh").remoteClientIds,["fresh-pc"]);
  store.setNotificationPrefs("fresh",{remoteClientIds:[]});
  assert.deepEqual(store.getNotificationPrefs("fresh").remoteClientIds,[]);
  assert.throws(()=>store.setNotificationPrefs("fresh",{remoteClient:{id:"foreign-pc",enabled:true}}));
});
