import assert from "node:assert/strict";
import test,{after} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {usageModelContributions} from "../lib/usage-model-contributions";
import type {UsageModel,UsageDay} from "../lib/account-types";
import {parseApiPrices} from "../lib/usage-cost-estimate";
const data=mkdtempSync(path.join(tmpdir(),"metis-model-contributions-"));
process.env.CHAT_DATA_DIR=data;process.env.CHAT_DB_PATH=path.join(data,"chat.sqlite");process.env.AI_CHAT_ROOT=data;process.env.AGENT_CWD=data;
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(data,{recursive:true,force:true});});
const model=(overrides:Partial<UsageModel>={}):UsageModel=>({modelId:"example",providerId:"cursor",requests:1,tokens:100,inputTokens:80,outputTokens:20,tokenReports:1,inputReports:1,outputReports:1,costUsd:1,costReports:1,estimatedCostUsd:2,estimatedCostReports:1,...overrides});
test("model shares follow tokens, requests and the chosen cost mode, sorted by contribution",()=>{
 const models=[model({providerId:"cursor",tokens:100,requests:3,costUsd:3,estimatedCostUsd:1}),model({providerId:"codex",tokens:300,requests:1,costUsd:1,estimatedCostUsd:3})];
 const day:UsageDay={...model(),date:"2026-10-01",tokens:400,requests:4,tokenReports:4,costReports:4,estimatedCostReports:4,costUsd:4,estimatedCostUsd:4};
 for(const [metric,mode,provider] of [["tokens","estimated","codex"],["requests","hidden","cursor"],["costUsd","reported","cursor"],["costUsd","estimated","codex"]] as const) {
  const result=usageModelContributions(day,models,metric,mode);
  assert.equal(result.rows[0].providerId,provider);assert.equal(result.rows[0].percentage,75);assert.equal(result.rows[1].percentage,25);
  assert.equal(result.partial,false);
 }
 assert.equal(usageModelContributions(day,models,"costUsd","hidden").total,null);
});
test("partial totals never invent missing measurements; unknown rows sort last",()=>{
 const day:UsageDay={...model(),date:"2026-10-01",requests:3,tokens:100,tokenReports:1,costReports:0,costUsd:null,estimatedCostReports:0,estimatedCostUsd:null};
 const rows=[model({modelId:"unknown",tokens:0,tokenReports:0,costReports:0,costUsd:null,estimatedCostReports:0,estimatedCostUsd:null}),model({modelId:"known"})];
 const tokens=usageModelContributions(day,rows,"tokens","reported");
 assert.equal(tokens.partial,true);assert.equal(tokens.rows[0].modelId,"known");assert.equal(tokens.rows[0].percentage,100);
 assert.equal(tokens.rows[1].value,null);assert.equal(tokens.rows[1].percentage,null);
 const cost=usageModelContributions(day,[rows[0]],"costUsd","estimated");assert.equal(cost.total,null);assert.equal(cost.rows[0].value,null);
});
test("zero totals and empty days never divide by zero or create false percentages",()=>{
 const day:UsageDay={...model({tokens:0,costUsd:0,estimatedCostUsd:0}),date:"2026-10-01"};
 for(const mode of ["reported","estimated"] as const) {
  const result=usageModelContributions(day,[model({costUsd:0,estimatedCostUsd:0})],"costUsd",mode);
  assert.equal(result.total,0);assert.equal(result.rows[0].percentage,null);assert.equal(result.partial,false);
 }
 assert.deepEqual(usageModelContributions({...day,requests:0},[],"requests","hidden").rows,[]);
});
async function fixture(name:string) {
 const auth=await import("../lib/auth"),{recordAccountUsage}=await import("../lib/account-usage");
 const user=auth.createUser(name,"synthetic-pass-123");
 for(const [id,providerId,inputTokens,completedAt] of [["a","cursor",80,"2026-10-01T23:59:59Z"],["b","codex",280,"2026-10-01T23:59:59Z"],["c","cursor",80,"2026-10-02T00:00:00Z"]] as const)
  recordAccountUsage(user.id,{id,role:"assistant",runMetadata:{providerId,modelId:"example",inputTokens,outputTokens:20,costUsd:inputTokens/80,completedAt}});
 return {...user,token:auth.authenticateUser(name,"synthetic-pass-123")!.token};
}
test("daily model aggregates are UTC-scoped, deduplicated by provider and model, and excluded from public day totals",async()=>{
 const {getAccountUsage}=await import("../lib/account-usage"),user=await fixture("contribution-owner");
 const prices=parseApiPrices({openai:{models:{example:{cost:{input:2,output:8}}}}});
 const usage=getAccountUsage(user.id,"2026-10-01","2026-10-03",prices);
 assert.equal(usage.modelDays?.["2026-10-01"].length,2);
 assert.equal(usage.modelDays?.["2026-10-02"].length,1);
 assert.equal(usage.modelDays?.["2026-10-03"],undefined);
 for(const day of usage.days) {
  assert.ok(!("models" in day) && !("modelDays" in day));
  const rows=usage.modelDays?.[day.date] || [];
  assert.equal(rows.reduce((sum,m)=>sum+m.tokens,0),day.tokens);
  assert.equal(rows.reduce((sum,m)=>sum+m.requests,0),day.requests);
  assert.equal(rows.reduce((sum,m)=>sum+(m.costUsd || 0),0),day.costUsd || 0);
  assert.ok(Math.abs(rows.reduce((sum,m)=>sum+(m.estimatedCostUsd || 0),0)-(day.estimatedCostUsd || 0))<1e-10);
 }
 assert.equal(usageModelContributions(usage.days[0],usage.modelDays!["2026-10-01"],"tokens","hidden").rows[0].percentage,75);
});
test("provider filtering recomputes percentages, excludes foreign models and preserves historical unknowns",async()=>{
 const {getAccountUsage,recordAccountUsage}=await import("../lib/account-usage"),user=await fixture("contribution-filter"),other=await fixture("contribution-other");
 recordAccountUsage(other.id,{id:"foreign",role:"assistant",runMetadata:{modelId:"foreign-private-model",providerId:"codex",completedAt:"2026-10-01T00:00:00Z"}});
 recordAccountUsage(user.id,{id:"unknown",role:"assistant",runMetadata:{modelId:"unknown",providerId:"cursor",completedAt:"2026-10-01T00:00:00Z"}});
 const filtered=getAccountUsage(user.id,"2026-10-01","2026-10-01",null,["codex"]);
 assert.equal(filtered.modelDays!["2026-10-01"].length,2);
 const result=usageModelContributions(filtered.days[0],filtered.modelDays!["2026-10-01"],"tokens","hidden");
 assert.equal(result.rows[0].percentage,100);assert.equal(result.rows[1].value,null);assert.equal(result.partial,true);
 assert.ok(!JSON.stringify(filtered).includes("foreign-private-model"));
 const empty=getAccountUsage(user.id,"2026-10-01","2026-10-01",null,["cursor","codex"]);
 assert.deepEqual(empty.modelDays,{});
});
test("the private usage endpoint supplies daily model breakdowns only for the authenticated owner and filters",async()=>{
 const {GET}=await import("../app/api/account-usage/route"),user=await fixture("contribution-endpoint");
 const url="http://localhost/api/account-usage?from=2026-10-01&to=2026-10-02&excludeProvider=cursor";
 assert.equal((await GET(new Request(url))).status,401);
 const response=await GET(new Request(url,{headers:{cookie:"ai_chat_auth="+user.token}}));
 assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
 const {usage}=await response.json();assert.equal(usage.modelDays["2026-10-01"][0].providerId,"codex");assert.equal(usage.modelDays["2026-10-02"],undefined);
 assert.equal(usage.modelDays["2026-10-01"][0].tokens,300);
});
