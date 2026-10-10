import assert from "node:assert/strict";
import test,{after} from "node:test";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {apiPriceIndex,parseApiPrices,resolveApiPrice,estimateApiValue} from "../lib/usage-cost-estimate";
import {usageCsv} from "../lib/account-usage-export";
const data=mkdtempSync(path.join(tmpdir(),"metis-api-costs-"));
process.env.CHAT_DATA_DIR=data;process.env.CHAT_DB_PATH=path.join(data,"chat.sqlite");process.env.AI_CHAT_ROOT=data;process.env.AGENT_CWD=data;
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(data,{recursive:true,force:true});});
const catalog=parseApiPrices({openai:{models:{"example-model":{cost:{input:2,output:8,cache_read:0.2}}}},anthropic:{models:{"example-claude":{cost:{input:3,output:15,cache_read:0.3,cache_write:3.75}}}}},"2026-10-10T00:00:00Z");
test("price parsing preserves free rates, rejects invalid prices and ignores context limits",()=>{
 const parsed=parseApiPrices({openai:{models:{free:{cost:{input:0,output:0}},bad:{cost:{input:-1,output:2}},missing:{limit:{context:1000000}},partial:{cost:{input:3}},invalid:{cost:{input:Infinity,output:2}}}}});
 assert.deepEqual(parsed.prices,[{providerId:"openai",modelId:"free",input:0,output:0}]);
});
test("registry references resolve exact agent API IDs, never guessed aliases or ambiguous vendors",()=>{
 const index=apiPriceIndex(catalog);
 assert.equal(resolveApiPrice("cursor","example-model",index)?.providerId,"openai");
 assert.equal(resolveApiPrice("codex","example-model",index)?.input,2);
 assert.equal(resolveApiPrice("claude-code","example-claude",index)?.providerId,"anthropic");
 assert.equal(resolveApiPrice("compatible","example-model",index),null);
 assert.equal(resolveApiPrice("cursor","example-model-fast",index),null);
 index.set(JSON.stringify(["anthropic","example-model"]),{providerId:"anthropic",modelId:"example-model",input:3,output:15});
 assert.equal(resolveApiPrice("cursor","example-model",index),null);
});
test("input/output weighting and cache discounts do not double charge included cache",()=>{
 assert.equal(estimateApiValue({input:1000000,output:100000,cached:600000,cacheWrite:0},{input:2,output:8,cacheRead:0.2}),1.72);
 assert.equal(estimateApiValue({input:400000,output:100000,cached:600000,cacheWrite:100000},{input:3,output:15,cacheRead:0.3,cacheWrite:3.75},false),3.255);
 assert.equal(estimateApiValue({input:0,output:0,cached:0,cacheWrite:0},{input:0,output:0}),0);
});
test("unknown splits, invalid cache and missing discount prices stay unavailable",()=>{
 const price={input:2,output:8};
 for(const usage of [{input:null,output:100,cached:null,cacheWrite:null},{input:10,output:null,cached:null,cacheWrite:null},{input:10,output:2,cached:20,cacheWrite:0},{input:10,output:2,cached:0,cacheWrite:3}])
  assert.equal(estimateApiValue(usage,price),null);
 assert.equal(estimateApiValue({input:10,output:2,cached:20,cacheWrite:0},{...price,cacheRead:0.2}),null);
 assert.equal(estimateApiValue({input:10,output:2,cached:null,cacheWrite:null},null),null);
});
test("estimates are owner-isolated, deduplicated, zero-fill days and never replace reported costs",async()=>{
 const auth=await import("../lib/auth"),{recordAccountUsage,getAccountUsage,getAccountModelUsage}=await import("../lib/account-usage");
 const user=auth.createUser("api-cost-owner","synthetic-pass-123"),other=auth.createUser("api-cost-other","synthetic-pass-123");
 const meta={providerId:"cursor",modelId:"example-model",inputTokens:1000000,outputTokens:100000,cachedInputTokens:600000,costUsd:9,completedAt:"2026-10-01T00:00:00Z"};
 const record=(id:string,overrides:Record<string,unknown>={},ownerId=user.id)=>recordAccountUsage(ownerId,{id,role:"assistant",runMetadata:{...meta,...overrides}});
 record("priced");record("priced");record("unknown",{modelId:"absent",costUsd:undefined});
 record("estimated-input",{inputTokensEstimated:true,costUsd:undefined});record("other",{},other.id);
 const result=getAccountUsage(user.id,"2026-10-01","2026-10-02",catalog);
 assert.equal(result.totals.costUsd,9);assert.equal(result.totals.costReports,1);
 assert.equal(result.totals.estimatedCostUsd,1.72);assert.equal(result.totals.estimatedCostReports,1);
 assert.deepEqual(result.days.map(day=>day.estimatedCostUsd),[1.72,null]);
 assert.equal(result.pricing?.checkedAt,catalog.checkedAt);
 assert.equal(getAccountUsage(user.id,"2026-10-01","2026-10-02").totals.estimatedCostUsd,null);
 const details=getAccountModelUsage(user.id,"cursor","example-model","2026-10-01","2026-10-02",catalog)!;
 assert.equal(details.estimatedCostUsd,1.72);assert.equal(details.requests,2);assert.equal(details.apiPrice?.input,2);
});
test("historical sync retains cache measurements and excludes cloned consumption",async()=>{
 const auth=await import("../lib/auth"),{getDatabase}=await import("../lib/sqlite"),{getAccountUsage}=await import("../lib/account-usage");
 const user=auth.createUser("api-cost-history","synthetic-pass-123"),db=getDatabase();
 const messages=[{id:"historic-cache",role:"assistant",runMetadata:{providerId:"claude-code",modelId:"example-claude",inputTokens:400000,outputTokens:100000,cachedInputTokens:600000,cacheWriteInputTokens:100000,completedAt:"2026-10-01T01:00:00Z"}}];
 db.prepare("INSERT INTO chats(id,owner_id,data,created_at,updated_at) VALUES(?,?,?,?,?)").run("api-history",user.id,JSON.stringify({messages}),"2026-10-01T00:00:00Z","2026-10-02T00:00:00Z");
 const totals=getAccountUsage(user.id,"2026-10-01","2026-10-02",catalog).totals;
 assert.equal(totals.estimatedCostUsd,3.255);assert.equal(totals.estimatedCostReports,1);
 const row=db.prepare("SELECT cached_input_tokens,cache_write_input_tokens FROM account_usage WHERE owner_id=?").get(user.id);
 assert.equal(row?.cached_input_tokens,600000);assert.equal(row?.cache_write_input_tokens,100000);
});
test("CSV follows selected cost view, includes estimate rates and removes all costs when hidden",()=>{
 const base={modelId:"example-model",providerId:"cursor",requests:1,inputTokens:100,outputTokens:20,tokens:120,costUsd:9,estimatedCostUsd:1.72,estimatedCostReports:1,tokenReports:1,costReports:1,inputReports:1,outputReports:1,apiPrice:catalog.prices[0]};
 assert.ok(usageCsv([base]).includes('"Reported cost USD"'));
 const estimate=usageCsv([base],"estimated");assert.ok(estimate.includes('"Estimated standard API value USD"'));assert.ok(estimate.includes('"1.72"'));assert.ok(estimate.includes('"openai"'));
 const hidden=usageCsv([base],"hidden");assert.ok(!/cost|value|USD/i.test(hidden));assert.ok(!hidden.includes('"9"'));
});
test("public activity rendering removes all monetary estimates",()=>{
 const source=readFileSync(path.join(import.meta.dirname,"../app/p/[shareId]/page.tsx"),"utf8");
 assert.ok(source.includes("estimatedCostUsd:null,estimatedCostReports:0"));
});
test("authenticated estimate endpoint uses cached price catalog without touching provider costs",async()=>{
 const {writeFileSync}=await import("node:fs"),auth=await import("../lib/auth"),{recordAccountUsage}=await import("../lib/account-usage");
 // Seed the public catalog in this isolated test installation; no network call.
 writeFileSync(path.join(data,"api-prices.json"),JSON.stringify({...catalog,checkedAt:new Date().toISOString()}));
 const user=auth.createUser("api-cost-endpoint","synthetic-pass-123");const token=auth.authenticateUser("api-cost-endpoint","synthetic-pass-123")!.token;
 recordAccountUsage(user.id,{id:"api-answer",role:"assistant",runMetadata:{providerId:"cursor",modelId:"example-model",inputTokens:1000000,outputTokens:100000,completedAt:"2026-10-01T00:00:00Z"}});
 const {GET}=await import("../app/api/account-usage/route");
 const response=await GET(new Request("http://localhost/api/account-usage?from=2026-10-01&to=2026-10-01&costMode=estimated",{headers:{cookie:"ai_chat_auth="+token}}));
 assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
 const {usage}=await response.json();assert.equal(usage.totals.estimatedCostUsd,2.8);assert.equal(usage.totals.costUsd,null);
});
