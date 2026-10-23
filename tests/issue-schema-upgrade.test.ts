import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "metis-issue-upgrade-"));
Object.assign(process.env, {
  AI_CHAT_ROOT: root, CHAT_DATA_DIR: root, CHAT_DB_PATH: path.join(root, "chat.sqlite"),
  AGENT_CWD: root, CHAT_PASSWORD: "", METIS_AI_BOOTSTRAP_PASSWORD: "",
  CHAT_LEGACY_HEADER_AUTH: "false", NODE_ENV: "test",
});
const modules = Promise.all([import("../lib/auth"), import("../lib/sqlite"), import("../lib/issues"), import("../app/api/issues/route"), import("../app/api/issues/[id]/route")]);
let loaded: Awaited<typeof modules>, userId: string, token: string;
const original = JSON.stringify({title:"Retain this original record",unknownField:{keep:true}});
const request = (method="GET", body?: unknown, authenticated=true) => new Request("http://localhost/api/issues?projectId=none", {
  method, headers:{...(authenticated?{cookie:"ai_chat_auth="+token}:{}),...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
});
before(async()=>{
  loaded = await modules;
  userId = loaded[0].createUser("upgrade-owner","synthetic-password").id;
  token = loaded[0].authenticateUser("upgrade-owner","synthetic-password")!.token;
  // Exact pre-project schema observed on the affected installation.
  loaded[1].getDatabase().exec(`
    CREATE TABLE issues (
      id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      identifier TEXT NOT NULL, number INTEGER NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL,
      chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL, data TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX issues_identifier ON issues(owner_id,identifier);
    CREATE INDEX issues_owner_status ON issues(owner_id,archived,status,updated_at DESC);
  `);
  loaded[1].getDatabase().prepare("INSERT INTO issues VALUES(?,?,?,?,?,?,NULL,?,1,0,?,?)")
    .run("legacy-record",userId,"OLD-1",1,"todo","none",original,"2026-01-01","2026-01-01");
});
after(()=>{loaded?.[1].getDatabase().close();rmSync(root,{recursive:true,force:true});});

test("an occupied legacy schema remains byte-for-byte intact and unexpected API failures are logged safely",async()=>{
  const response=await loaded[3].GET(request());
  assert.equal(response.status,500);
  const body=await response.json();
  assert.match(body.error,/temporarily unavailable.*Reference #/);
  assert.doesNotMatch(body.error,/legacy|SELECT|sqlite/i);
  const db=loaded[1].getDatabase();
  assert.equal((db.prepare("SELECT data FROM issues WHERE id='legacy-record'").get() as {data:string}).data,original);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='issues_legacy_v1'").get(),undefined);
  const logs=db.prepare("SELECT message FROM error_logs WHERE source='api'").all() as Array<{message:string}>;
  assert.ok(logs.some(row=>row.message.includes("legacy issue table contains records")));
});

test("the empty legacy schema upgrades atomically and real issue list/create/update routes recover",async()=>{
  const db=loaded[1].getDatabase();
  db.prepare("DELETE FROM issues WHERE id=?").run("legacy-record"); // Remove only our synthetic fixture.
  const listed=await loaded[3].GET(request());
  assert.equal(listed.status,200);
  assert.deepEqual((await listed.json()).issues,[]);
  const columns=(table:string)=>db.prepare("PRAGMA table_info("+table+")").all() as Array<{name:string}>;
  assert.ok(columns("issues").some(column=>column.name==="issue_key"));
  assert.ok(columns("issues_legacy_v1").some(column=>column.name==="identifier"));
  assert.equal(columns("issues").some(column=>column.name==="identifier"),false);
  const createdResponse=await loaded[3].POST(request("POST",{title:"Issue after upgrade",status:"todo"}));
  assert.equal(createdResponse.status,201);
  const {issue}=await createdResponse.json();
  const changed=await loaded[4].PATCH(request("PATCH",{status:"done",expectedVersion:issue.version}),{params:Promise.resolve({id:issue.id})});
  assert.equal(changed.status,200);
  assert.equal((await changed.json()).issue.status,"done");
  const again=await loaded[3].GET(request());
  assert.equal((await again.json()).issues[0].id,issue.id);
  assert.equal((await loaded[3].GET(request("GET",undefined,false))).status,401);
  loaded[2].issueDatabase();
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
});
