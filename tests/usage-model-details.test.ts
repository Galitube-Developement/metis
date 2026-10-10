import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { usageConfiguration } from "../lib/usage-configuration";

const data=mkdtempSync(path.join(tmpdir(),"metis-model-usage-"));
process.env.CHAT_DATA_DIR=data;process.env.CHAT_DB_PATH=path.join(data,"chat.sqlite");process.env.AI_CHAT_ROOT=data;process.env.AGENT_CWD=data;
// Exercise an existing installation's old ledger, not only a fresh schema.
const legacy=new DatabaseSync(process.env.CHAT_DB_PATH);
legacy.exec("CREATE TABLE account_usage(owner_id TEXT NOT NULL,message_id TEXT NOT NULL,model_id TEXT NOT NULL,provider_id TEXT NOT NULL,completed_at TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,total_tokens INTEGER,cost_usd REAL,PRIMARY KEY(owner_id,message_id))");
legacy.close();
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(data,{recursive:true,force:true});});
async function owner(name:string) {
  const auth=await import("../lib/auth");const user=auth.createUser(name,"synthetic-password-123");
  return {...user,token:auth.authenticateUser(name,"synthetic-password-123")!.token};
}
const base={modelId:"model-example",providerId:"cursor",inputTokens:100,outputTokens:20,completedAt:"2026-05-01T23:59:59.000Z"};
test("selection snapshots preserve aliases, explicit off/none, advertised tiers and unknown values",()=>{
  assert.deepEqual(usageConfiguration([{id:"reasoning",value:"high"},{id:"fast",value:"false"}],200000),{configuredContextWindow:200000,reasoningEffort:"high",speedMode:"standard"});
  assert.deepEqual(usageConfiguration([{id:"effort",value:"none"},{id:"speed",value:"fast"}],1000000),{configuredContextWindow:1000000,reasoningEffort:"none",speedMode:"fast"});
  assert.deepEqual(usageConfiguration([{id:"speed",value:"flex"}]),{speedMode:"flex"});
  assert.deepEqual(usageConfiguration(undefined,NaN),{});
  assert.deepEqual(usageConfiguration([{id:"fast",value:"maybe"},{id:"effort",value:"bad value"}],-1),{});
});
test("old ledger gains detail columns without changing totals",async()=>{
  const {getDatabase}=await import("../lib/sqlite");
  const columns=getDatabase().prepare("PRAGMA table_info(account_usage)").all() as Array<{name:string}>;
  for(const name of ["context_window","reasoning_effort","speed_mode"])assert.ok(columns.some(column=>column.name===name));
});
test("model history isolates owner/provider, zero-fills UTC days, deduplicates and groups settings",async()=>{
  const {recordAccountUsage,getAccountModelUsage,getAccountUsage}=await import("../lib/account-usage");
  const user=await owner("details-first"),other=await owner("details-other");
  const record=(id:string,meta:Partial<typeof base>&ReturnType<typeof usageConfiguration>,ownerId=user.id)=>recordAccountUsage(ownerId,{id,role:"assistant",runMetadata:{...base,...meta}});
  record("a",usageConfiguration([{id:"effort",value:"high"},{id:"fast",value:"true"}],200000));
  record("a",usageConfiguration([{id:"effort",value:"high"},{id:"fast",value:"true"}],200000));
  record("b",{...usageConfiguration([{id:"effort",value:"low"},{id:"speed",value:"default"}],1000000),completedAt:"2026-05-02T00:00:00Z"});
  record("c",{});
  record("other-provider",{providerId:"codex",inputTokens:900});
  record("other-owner",{inputTokens:900},other.id);
  record("outside",{completedAt:"2026-05-04T00:00:00Z"});
  const details=getAccountModelUsage(user.id,"cursor",base.modelId,"2026-05-01","2026-05-03")!;
  assert.equal(details.requests,3);assert.equal(details.tokens,360);
  assert.deepEqual(details.days.map(day=>day.requests),[2,1,0]);
  assert.deepEqual(new Map(details.configurations.context.map(bucket=>[bucket.value,bucket.requests])),new Map([["200000",1],["1000000",1],[null,1]]));
  assert.equal(details.configurations.speed.find(bucket=>bucket.value==="fast")?.requests,1);
  assert.equal(details.configurations.speed.find(bucket=>bucket.value==="standard")?.requests,1);
  assert.equal(details.configurations.reasoning.find(bucket=>bucket.value==="high")?.requests,1);
  assert.equal(details.days[0].configurations.speed.find(bucket=>bucket.value===null)?.requests,1);
  assert.equal(getAccountUsage(user.id,"2026-05-01","2026-05-03").totals.requests,4);
  assert.equal(getAccountModelUsage(user.id,"missing",base.modelId,"2026-05-01","2026-05-03"),null);
});
test("historical unknowns stay unknown; inferred capacity and context occupancy are not selections",async()=>{
  const {recordAccountUsage,getAccountModelUsage}=await import("../lib/account-usage");const user=await owner("details-unknown");
  recordAccountUsage(user.id,{id:"unknown",role:"assistant",runMetadata:{...base,contextWindow:1000000,contextWindowSource:"inferred",contextUsedTokens:200000}});
  const details=getAccountModelUsage(user.id,"cursor",base.modelId,"2026-05-01","2026-05-01")!;
  for(const buckets of Object.values(details.configurations))assert.deepEqual(buckets,[{value:null,requests:1}]);
  assert.equal(details.tokens,120);
});
test("recorded settings survive an older worker updating the same answer without detail fields",async()=>{
  const {recordAccountUsage,getAccountModelUsage}=await import("../lib/account-usage");const user=await owner("details-old-worker");
  recordAccountUsage(user.id,{id:"preserved",role:"assistant",runMetadata:{...base,...usageConfiguration([{id:"fast",value:"true"}],200000)}});
  recordAccountUsage(user.id,{id:"preserved",role:"assistant",runMetadata:{...base,outputTokens:30}});
  const details=getAccountModelUsage(user.id,"cursor",base.modelId,"2026-05-01","2026-05-01")!;
  assert.equal(details.tokens,130);assert.deepEqual(details.configurations.speed,[{value:"fast",requests:1}]);
});
test("versioned historical sync uses only the exact owned run's job settings and preserves deleted history",async()=>{
  const {getDatabase}=await import("../lib/sqlite");const {getAccountModelUsage}=await import("../lib/account-usage");const user=await owner("details-backfill");
  const db=getDatabase(),created="2026-01-01T00:00:00Z",chatId="details-history";
  const meta={...base,contextWindow:200000};
  const transcript={id:chatId,ownerId:user.id,modelParams:[{id:"effort",value:"low"}],messages:[{id:"historic-answer",role:"assistant",runMetadata:meta},{id:"unbound-answer",role:"assistant",runMetadata:meta}]};
  db.prepare("INSERT INTO chats(id,owner_id,data,created_at,updated_at) VALUES(?,?,?,?,?)").run(chatId,user.id,JSON.stringify(transcript),created,created);
  db.prepare("INSERT INTO account_usage_sync(owner_id,chat_id,revision) VALUES(?,?,?)").run(user.id,chatId,created);
  db.prepare("INSERT INTO jobs(id,chat_id,user_id,data,status,updated_at) VALUES(?,?,?,?,?,?)").run("exact-job",chatId,user.id,JSON.stringify({modelParams:[{id:"effort",value:"high"},{id:"fast",value:"true"}]}),"completed",created);
  db.prepare("INSERT INTO run_events(job_id,chat_id,user_id,event,data,created_at) VALUES(?,?,?,?,?,?)").run("exact-job",chatId,user.id,"assistantId",JSON.stringify({messageId:"historic-answer"}),created);
  let details=getAccountModelUsage(user.id,"cursor",base.modelId,"2026-05-01","2026-05-01")!;
  assert.equal(details.requests,2);
  assert.deepEqual(details.configurations.reasoning,[{value:"high",requests:1},{value:null,requests:1}]);
  assert.deepEqual(details.configurations.speed,[{value:"fast",requests:1},{value:null,requests:1}]);
  assert.equal(db.prepare("SELECT revision FROM account_usage_sync WHERE owner_id=?").get(user.id)?.revision,"model-details-v1:"+created);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  details=getAccountModelUsage(user.id,"cursor",base.modelId,"2026-05-01","2026-05-01")!;
  assert.equal(details.requests,2);
});
test("model endpoint requires authentication, validates filters and never exposes another account",async()=>{
  const {GET}=await import("../app/api/account-usage/route");const {recordAccountUsage}=await import("../lib/account-usage");
  const user=await owner("details-api"),other=await owner("details-api-other");
  recordAccountUsage(other.id,{id:"private",role:"assistant",runMetadata:base});
  const url="http://localhost/api/account-usage?from=2026-05-01&to=2026-05-01&modelId=model-example&providerId=cursor";
  assert.equal((await GET(new Request(url))).status,401);
  const req=(suffix="")=>new Request(url+suffix,{headers:{cookie:"ai_chat_auth="+user.token}});
  assert.equal((await GET(req("&ownerId="+other.id))).status,404);
  assert.equal((await GET(new Request("http://localhost/api/account-usage?modelId=x",{headers:{cookie:"ai_chat_auth="+user.token}}))).status,400);
  recordAccountUsage(user.id,{id:"own",role:"assistant",runMetadata:base});
  const response=await GET(req());assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.equal((await response.json()).details.requests,1);
});
