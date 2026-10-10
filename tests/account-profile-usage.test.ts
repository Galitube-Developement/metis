import assert from "node:assert/strict";
import test, {after} from "node:test";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const data=mkdtempSync(path.join(tmpdir(),"metis-account-"));
process.env.CHAT_DATA_DIR=data;process.env.CHAT_DB_PATH=path.join(data,"chat.sqlite");process.env.AI_CHAT_ROOT=data;process.env.AGENT_CWD=data;
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(data,{recursive:true,force:true});});
const profile={displayName:"Test profile",bio:"A public bio",avatar:null,links:[{label:"Website",url:"https://example.com"}],sharing:false,shareActivity:false};
async function owner(name:string) { const auth=await import("../lib/auth");const user=auth.createUser(name,"synthetic-password-123");const session=auth.authenticateUser(name,"synthetic-password-123")!;return {...user,token:session.token}; }
function request(token?:string,body?:unknown,url="http://localhost/api/profile"){return new Request(url,{method:body?"PUT":"GET",headers:{...(token?{cookie:"ai_chat_auth="+token}:{}),...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});}
test("profile API requires auth, preserves login identity, and isolates account edits",async()=>{
  const route=await import("../app/api/profile/route");const first=await owner("profile-first"),second=await owner("profile-second");
  assert.equal((await route.GET(request())).status,401);assert.equal((await route.PUT(request(undefined,profile))).status,401);
  assert.equal((await route.PUT(request(first.token,profile))).status,200);
  assert.equal((await (await route.GET(request(first.token))).json()).profile.displayName,"Test profile");
  assert.equal((await (await route.GET(request(second.token))).json()).profile.displayName,second.username);
  const {getDatabase}=await import("../lib/sqlite");assert.equal((getDatabase().prepare("SELECT username FROM users WHERE id=?").get(first.id) as {username:string}).username,first.username);
});
test("sharing is opt-in and revocation rotates the public token",async()=>{
  const {saveAccountProfile,getSharedProfile}=await import("../lib/account-profile");const user=await owner("profile-shared");
  assert.equal(saveAccountProfile(user.id,profile).shareId,null);
  const shared=saveAccountProfile(user.id,{...profile,sharing:true});assert.match(shared.shareId!,/^[a-f0-9]{48}$/);
  assert.equal(getSharedProfile(shared.shareId!)?.profile.shareActivity,false);
  saveAccountProfile(user.id,{...profile,sharing:false});assert.equal(getSharedProfile(shared.shareId!),null);
  const next=saveAccountProfile(user.id,{...profile,sharing:true});assert.notEqual(next.shareId,shared.shareId);
  assert.equal(getSharedProfile(user.id),null);
});
test("profile rejects executable URLs, credentials, SVG avatars and unknown ownership fields",async()=>{
  const {saveAccountProfile}=await import("../lib/account-profile");const user=await owner("profile-validation");
  for(const url of ["javascript:alert(1)","data:text/html,evil","https://name:secret@example.com"])assert.throws(()=>saveAccountProfile(user.id,{...profile,links:[{label:"x",url}]}));
  assert.throws(()=>saveAccountProfile(user.id,{...profile,avatar:"data:image/svg+xml;base64,PHN2Zz4="}));
  assert.throws(()=>saveAccountProfile(user.id,{...profile,ownerId:"another-owner"}));
  assert.throws(()=>saveAccountProfile(user.id,{...profile,displayName:" "}));
  assert.throws(()=>saveAccountProfile(user.id,{...profile,links:Array(6).fill(profile.links[0])}));
});
test("avatar validation accepts PNGs and bounds decoded dimensions and bytes",async()=>{
  const {saveAccountProfile}=await import("../lib/account-profile");const user=await owner("profile-avatar");
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=","base64");
  const avatar="data:image/png;base64,"+png.toString("base64");assert.equal(saveAccountProfile(user.id,{...profile,avatar}).avatar,avatar);
  const enormous=Buffer.from(png);enormous.writeUInt32BE(100_000,16);
  assert.throws(()=>saveAccountProfile(user.id,{...profile,avatar:"data:image/png;base64,"+enormous.toString("base64")}));
});
test("usage is owner-scoped, deduplicated and does not count context or cache twice",async()=>{
  const {recordAccountUsage,getAccountUsage}=await import("../lib/account-usage");
  const first=await owner("usage-first"),second=await owner("usage-second");
  const message={id:"run-one",role:"assistant" as const,runMetadata:{modelId:"fixture-model",providerId:"fixture-provider",inputTokens:100,outputTokens:20,cachedInputTokens:90,contextUsedTokens:50000,costUsd:0.005,completedAt:"2026-05-01T23:59:59.000Z"}};
  recordAccountUsage(first.id,message);recordAccountUsage(first.id,message);
  recordAccountUsage(second.id,{...message,id:"other",runMetadata:{...message.runMetadata,inputTokens:900}});
  const usage=getAccountUsage(first.id,"2026-05-01","2026-05-02");
  assert.equal(usage.totals.requests,1);assert.equal(usage.totals.tokens,120);assert.equal(usage.totals.costUsd,0.005);
  assert.equal(usage.days[0].tokens,120);assert.equal(usage.days[1].tokens,0);
  assert.equal(usage.models.length,1);assert.equal(usage.models[0].providerId,"fixture-provider");
});
test("missing and estimated values stay unavailable; free cost zero is a reported value",async()=>{
  const {recordAccountUsage,getAccountUsage}=await import("../lib/account-usage");const user=await owner("usage-unknown");
  recordAccountUsage(user.id,{id:"estimate",role:"assistant",runMetadata:{inputTokens:12345,inputTokensEstimated:true,contextUsedTokens:60000,completedAt:"2026-06-01T10:00:00Z"}});
  let usage=getAccountUsage(user.id,"2026-06-01","2026-06-01");assert.equal(usage.totals.tokens,0);assert.equal(usage.totals.tokenReports,0);assert.equal(usage.totals.costUsd,null);
  recordAccountUsage(user.id,{id:"free",role:"assistant",runMetadata:{inputTokens:10,outputTokens:0,totalProcessedTokens:42,costUsd:0,completedAt:"2026-06-01T11:00:00Z"}});
  usage=getAccountUsage(user.id,"2026-06-01","2026-06-01");assert.equal(usage.totals.tokens,42);assert.equal(usage.totals.costUsd,0);assert.equal(usage.totals.costReports,1);
  assert.equal(usage.totals.inputReports,1);assert.equal(usage.totals.outputReports,1);
});
test("UTC range includes the final day, validates dates, and zero-fills empty years",async()=>{
  const {recordAccountUsage,getAccountUsage,usageRange}=await import("../lib/account-usage");const user=await owner("usage-dates");
  recordAccountUsage(user.id,{id:"late",role:"assistant",runMetadata:{inputTokens:7,completedAt:"2026-07-01T23:59:59.999Z"}});
  recordAccountUsage(user.id,{id:"next",role:"assistant",runMetadata:{inputTokens:9,completedAt:"2026-07-02T00:00:00.000Z"}});
  assert.equal(getAccountUsage(user.id,"2026-07-01","2026-07-01").totals.tokens,7);
  assert.throws(()=>usageRange("2026-02-30","2026-03-01"));assert.throws(()=>usageRange("2026-07-02","2026-07-01"));assert.throws(()=>usageRange("2020-01-01","2026-01-01"));
  assert.equal(getAccountUsage(user.id,"2025-01-01","2025-12-31").days.length,365);
});
test("historical backfill skips shared clones and survives chat deletion",async()=>{
  const {getDatabase}=await import("../lib/sqlite");const {getAccountUsage}=await import("../lib/account-usage");const user=await owner("usage-history");
  const createdAt="2026-01-01T00:00:00Z",message={id:"historical",role:"assistant",runMetadata:{modelId:"historical-model",inputTokens:99,completedAt:"2026-01-02T00:00:00Z"}};
  const insert=(id:string,created:string)=>getDatabase().prepare("INSERT INTO chats(id,owner_id,data,created_at,updated_at)VALUES(?,?,?,?,?)").run(id,user.id,JSON.stringify({id,ownerId:user.id,createdAt:created,updatedAt:created,messages:[message]}),created,created);
  insert("real-history",createdAt);insert("shared-clone","2026-02-01T00:00:00Z");
  assert.equal(getAccountUsage(user.id,"2026-01-01","2026-02-02").totals.requests,1);
  getDatabase().prepare("DELETE FROM chats WHERE owner_id=?").run(user.id);
  assert.equal(getAccountUsage(user.id,"2026-01-01","2026-02-02").totals.tokens,99);
});
test("live assistant persistence records usage without opening the dashboard",async()=>{
  const store=await import("../lib/db-store");const {getDatabase}=await import("../lib/sqlite");const user=await owner("usage-live");
  const chat=store.createChat("Usage test",undefined,user.id);
  store.upsertMessage(chat.id,{id:"live-run",role:"assistant",content:"fixture",runMetadata:{inputTokens:33,outputTokens:2,completedAt:"2026-08-01T00:00:00Z"}});
  const row=getDatabase().prepare("SELECT total_tokens FROM account_usage WHERE owner_id=? AND message_id=?").get(user.id,"live-run") as {total_tokens:number};
  assert.equal(row.total_tokens,35);
});
test("usage API cannot be redirected to another owner and validates range",async()=>{
  const {GET}=await import("../app/api/account-usage/route");const user=await owner("usage-api");
  assert.equal((await GET(request(undefined,undefined,"http://localhost/api/account-usage"))).status,401);
  assert.equal((await GET(request(user.token,undefined,"http://localhost/api/account-usage?from=bad&to=bad"))).status,400);
  const response=await GET(request(user.token,undefined,"http://localhost/api/account-usage?ownerId=another-owner"));
  assert.equal(response.status,200);assert.equal((await response.json()).usage.totals.requests,0);
});


test("CSV leaves unavailable tokens blank and preserves reported zero values",async()=>{
  const {usageCsv}=await import("../lib/account-usage-export");
  const base={modelId:"Example",providerId:"fixture",requests:1,inputTokens:0,outputTokens:0,tokens:0,costUsd:null,tokenReports:0,costReports:0,inputReports:0,outputReports:0};
  const unknown=usageCsv([base]).split("\r\n")[1];
  assert.equal(unknown,'"Example","fixture","1","","","","","0","0"');
  const reported=usageCsv([{...base,costUsd:0,tokenReports:1,costReports:1,inputReports:1,outputReports:1}]).split("\r\n")[1];
  assert.equal(reported,'"Example","fixture","1","0","0","0","0","1","1"');
});
test("CSV quotes labels and neutralizes spreadsheet formulas including leading whitespace",async()=>{
  const {usageCsv}=await import("../lib/account-usage-export");
  const csv=usageCsv([{modelId:' =1+1',providerId:'A, "B"',requests:1,inputTokens:2,outputTokens:3,tokens:5,costUsd:0,tokenReports:1,costReports:1,inputReports:1,outputReports:1}]);
  assert.ok(csv.includes("' =1+1"));assert.ok(csv.includes('"A, ""B"""'));
});
