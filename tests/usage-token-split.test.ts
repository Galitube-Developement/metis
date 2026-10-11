import assert from "node:assert/strict";
import test from "node:test";
import { splitUsageInput, usageConsumptionTokens, usageTokenValue } from "../lib/usage-token-split";
import { createAiUsageAccumulator } from "../lib/providers/ai-usage-accumulator";
import type { LanguageModelUsage } from "ai";

test("inclusive and exclusive provider input are disjoint without charging cache twice", () => {
 const inclusive=splitUsageInput({input:1000,cached:900,cacheWrite:20},true);
 assert.deepEqual(inclusive,{uncached:80,cached:900,writes:20,unclassified:0});
 assert.deepEqual(splitUsageInput({input:80,cached:900,cacheWrite:20},false),inclusive);
 assert.equal(usageConsumptionTokens({input:80,output:50,cached:900,cacheWrite:20,total:130,processed:null},false),1050);
 assert.equal(usageConsumptionTokens({input:1000,output:50,cached:900,cacheWrite:20,total:1050,processed:null},true),1050);
 assert.equal(usageConsumptionTokens({input:80,output:50,cached:900,cacheWrite:20,total:130,processed:1050},false),1050);
});

test("missing cache, unknown membership and invalid counters never produce fake uncached input", () => {
 assert.deepEqual(splitUsageInput({input:1000,cached:900,cacheWrite:null},true),{uncached:null,cached:900,writes:null,unclassified:100});
 assert.deepEqual(splitUsageInput({input:1000,cached:null,cacheWrite:null},true),{uncached:null,cached:null,writes:null,unclassified:1000});
 assert.equal(splitUsageInput({input:100,cached:90,cacheWrite:0}).uncached,null);
 assert.equal(splitUsageInput({input:100,cached:150,cacheWrite:0},true).unclassified,null);
 assert.equal(splitUsageInput({input:100,cached:150,cacheWrite:0},true).uncached,null);
 assert.equal(splitUsageInput({input:80,cached:null,cacheWrite:null},false).uncached,80);
 assert.deepEqual(splitUsageInput({input:0,cached:0,cacheWrite:0},true),{uncached:0,cached:0,writes:0,unclassified:0});
});

test("token selection preserves measured zero versus unreported values", () => {
 const v={requests:1,inputTokens:100,outputTokens:20,tokens:120,costUsd:null,tokenReports:1,costReports:0,inputReports:1,outputReports:1,
  cachedInputTokens:0,cachedInputReports:1,uncachedInputTokens:0,uncachedInputReports:0};
 assert.equal(usageTokenValue(v,"cachedInputTokens"),0);
 assert.equal(usageTokenValue(v,"uncachedInputTokens"),null);
 assert.equal(usageTokenValue(v,"tokens"),120);
});

function part(input:number,cached:number|undefined,writes:number|undefined):LanguageModelUsage {
 return {inputTokens:input,outputTokens:10,totalTokens:input+10,inputTokenDetails:{noCacheTokens:undefined,cacheReadTokens:cached,cacheWriteTokens:writes},outputTokenDetails:{textTokens:10,reasoningTokens:undefined}};
}
test("SDK cache measurements sum across rounds; an unreported round stays incomplete", () => {
 const a=createAiUsageAccumulator();
 a.add(part(100,90,0));a.add(part(200,180,5));
 assert.equal(a.usage.inputTokens,300);assert.equal(a.usage.cachedInputTokens,270);
 assert.equal(a.usage.cacheWriteInputTokens,5);assert.equal(a.usage.totalTokens,320);
 a.add(part(300,undefined,undefined));
 assert.equal(a.usage.inputTokens,600);assert.equal(a.usage.cachedInputTokens,undefined);
 assert.equal(a.usage.cacheWriteInputTokens,undefined);
 const zero=createAiUsageAccumulator();zero.add(part(100,0,0));
 assert.equal(zero.usage.cachedInputTokens,0);assert.equal(zero.usage.cacheWriteInputTokens,0);
});


test("Cursor's registry uses exclusive SDK input; Codex uses inclusive input",async()=>{
 const {getProviderDefinition}=await import("../lib/providers/registry");
 assert.equal(getProviderDefinition("cursor")?.apiPricing?.inputIncludesCache,false);
 assert.equal(getProviderDefinition("codex")?.apiPricing?.inputIncludesCache,true);
 const split=splitUsageInput({input:80,cached:900,cacheWrite:20},getProviderDefinition("cursor")?.apiPricing?.inputIncludesCache);
 assert.equal(split.uncached,80);
 assert.equal(usageConsumptionTokens({input:80,output:50,cached:900,cacheWrite:20,total:1050,processed:null},false),1050);
});
