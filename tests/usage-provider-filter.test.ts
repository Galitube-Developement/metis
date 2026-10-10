import assert from "node:assert/strict";
import test,{after} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {usageCsv} from "../lib/account-usage-export";
import {parseApiPrices} from "../lib/usage-cost-estimate";
const data=mkdtempSync(path.join(tmpdir(),"metis-provider-filter-"));
process.env.CHAT_DATA_DIR=data;process.env.CHAT_DB_PATH=path.join(data,"chat.sqlite");process.env.AI_CHAT_ROOT=data;process.env.AGENT_CWD=data;
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(data,{recursive:true,force:true});});
async function fixture(name:string) {
 const auth=await import("../lib/auth"),usage=await import("../lib/account-usage");
 const user=auth.createUser(name,"synthetic-pass-123");
 for(const [id,providerId,inputTokens,costUsd] of [["a","cursor",100,1],["b","codex",200,2],["c","custom-provider",300,3]] as const)
  usage.recordAccountUsage(user.id,{id,role:"assistant",runMetadata:{providerId,modelId:"example-model",inputTokens,outputTokens:20,costUsd,completedAt:"2026-10-01T00:00:00Z"}});
 return {...user,token:auth.authenticateUser(name,"synthetic-pass-123")!.token};
}
test("provider exclusion changes every total, daily graph and exported model while retaining menu choices",async()=>{
 const {getAccountUsage}=await import("../lib/account-usage"),user=await fixture("filter-main");
 const prices=parseApiPrices({openai:{models:{"example-model":{cost:{input:2,output:8}}}}});
 const all=getAccountUsage(user.id,"2026-10-01","2026-10-02",prices);
 const filtered=getAccountUsage(user.id,"2026-10-01","2026-10-02",prices,["cursor"]);
 assert.equal(all.totals.requests,3);assert.equal(filtered.totals.requests,2);assert.equal(filtered.totals.tokens,540);
 assert.equal(filtered.totals.costUsd,5);assert.equal(filtered.totals.estimatedCostReports,1);assert.equal(filtered.totals.estimatedCostUsd,0.00056);
 assert.deepEqual(filtered.providers,all.providers);
 assert.equal(filtered.days[0].costUsd,5);assert.equal(filtered.days[1].requests,0);
 assert.ok(!usageCsv(filtered.models).includes('"cursor"'));
 assert.equal(filtered.providers?.find(provider=>provider.id==="custom-provider")?.name,"custom-provider");
});
test("all providers can be disabled, unknown exclusions are harmless and filter matching is exact",async()=>{
 const {getAccountUsage}=await import("../lib/account-usage"),user=await fixture("filter-empty");
 const empty=getAccountUsage(user.id,"2026-10-01","2026-10-02",null,["cursor","codex","custom-provider"]);
 assert.equal(empty.models.length,0);assert.equal(empty.totals.requests,0);assert.equal(empty.totals.costUsd,null);
 assert.equal(empty.providers?.length,3);assert.deepEqual(empty.days.map(day=>day.requests),[0,0]);
 assert.equal(getAccountUsage(user.id,"2026-10-01","2026-10-02",null,["Cursor","absent"]).totals.requests,3);
});
test("provider options include only the owner's selected date range",async()=>{
 const {getAccountUsage,recordAccountUsage}=await import("../lib/account-usage"),user=await fixture("filter-owner");
 const other=await fixture("filter-neighbor");
 recordAccountUsage(other.id,{id:"private-provider",role:"assistant",runMetadata:{providerId:"neighbor-only",modelId:"private",completedAt:"2026-10-01T00:00:00Z"}});
 recordAccountUsage(user.id,{id:"outside",role:"assistant",runMetadata:{providerId:"outside-range",modelId:"outside",completedAt:"2026-10-03T00:00:00Z"}});
 const providers=getAccountUsage(user.id,"2026-10-01","2026-10-02").providers!;
 assert.equal(providers.length,3);assert.ok(!providers.some(p=>p.id==="neighbor-only" || p.id==="outside-range"));
});
test("authenticated filter endpoint validates values and never accepts another owner",async()=>{
 const {GET}=await import("../app/api/account-usage/route"),user=await fixture("filter-endpoint");
 const url="http://localhost/api/account-usage?from=2026-10-01&to=2026-10-02";
 const request=(suffix:string)=>new Request(url+suffix,{headers:{cookie:"ai_chat_auth="+user.token}});
 assert.equal((await GET(new Request(url+"&excludeProvider=cursor"))).status,401);
 const response=await GET(request("&excludeProvider=cursor&excludeProvider=custom-provider&ownerId=neighbor"));
 assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
 const {usage}=await response.json();assert.equal(usage.totals.requests,1);assert.equal(usage.models[0].providerId,"codex");assert.equal(usage.providers.length,3);
 for(const suffix of ["&excludeProvider=","&excludeProvider="+"a".repeat(129),"&excludeProvider=cursor".repeat(101)])
  assert.equal((await GET(request(suffix))).status,400);
});
